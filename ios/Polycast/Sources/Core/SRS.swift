import Foundation

// MARK: - Prompt Type

enum PromptType {
    case recognition
    case recall
    case guidedCloze
    case contextComprehension
    case targetCloze
}

func getPromptType(card: SavedWord) -> PromptType {
    let hasExample = card.exampleSentence != nil && !card.exampleSentence!.isEmpty
    let stage = card.promptStage ?? 0
    if stage == 0 { return .recognition }
    if stage == 1 { return .recall }
    if !hasExample { return .recall }
    if stage == 2 { return .guidedCloze }
    if stage == 3 { return .contextComprehension }
    return .targetCloze
}

func getInstructionText(_ promptType: PromptType) -> String {
    switch promptType {
    case .recognition: return "What does this word mean?"
    case .recall: return "How do you say this?"
    case .guidedCloze, .contextComprehension, .targetCloze: return "Fill in the blank"
    }
}

// MARK: - SRS Algorithm

private let learningSteps = [60, 600]         // 1 min, 10 min
private let graduatingInterval = 86400        // 1 day
private let easyGraduatingInterval = 345600   // 4 days
private let relearningStep = 600              // 10 min
private let minReviewInterval = 86400         // 1 day

func getNextDueSeconds(card: SavedWord, answer: String) -> Int {
    let inLearning = card.learningStep != nil || card.srsInterval == 0
    let isRelearning = card.learningStep != nil && card.srsInterval > 0

    if inLearning {
        let step = card.learningStep ?? 0

        switch answer {
        case "again":
            return learningSteps[0]
        case "hard":
            return step == 0 ? 360 : learningSteps[1]
        case "good":
            if step >= learningSteps.count - 1 {
                return isRelearning ? card.srsInterval : graduatingInterval
            }
            return learningSteps[step + 1]
        case "easy":
            return easyGraduatingInterval
        default:
            return learningSteps[0]
        }
    }

    // Review phase
    let oldInterval = card.srsInterval
    let ease = card.easeFactor

    switch answer {
    case "again":
        return relearningStep
    case "hard":
        return max(Int(round(Double(oldInterval) * 1.2)), minReviewInterval)
    case "good":
        return max(Int(round(Double(oldInterval) * ease)), minReviewInterval)
    case "easy":
        return max(Int(round(Double(oldInterval) * ease * 1.3)), minReviewInterval)
    default:
        return minReviewInterval
    }
}

// MARK: - Formatting

func formatDuration(_ seconds: Int) -> String {
    if seconds < 60 { return "\(seconds) s" }
    if seconds < 3600 { return "\(Int(round(Double(seconds) / 60))) min" }
    if seconds < 86400 { return "\(Int(round(Double(seconds) / 3600))) hr" }
    if seconds < 2592000 {
        let days = Int(round(Double(seconds) / 86400))
        return "\(days) d"
    }
    let months = Int(round(Double(seconds) / 2592000))
    return "\(months) mo"
}

func getButtonTimeLabel(card: SavedWord, answer: String) -> String {
    formatDuration(getNextDueSeconds(card: card, answer: answer))
}

func isNewCard(_ card: SavedWord) -> Bool {
    card.srsInterval == 0 && card.learningStep == nil && card.lastReviewedAt == nil
}

// MARK: - Due Status

enum DueUrgency {
    case new, learning, due, upcoming
}

struct DueStatus {
    let label: String
    let urgency: DueUrgency
}

func getDueStatus(_ card: SavedWord) -> DueStatus {
    if isNewCard(card) {
        return DueStatus(label: "New", urgency: .new)
    }
    if let dueAt = card.dueAt,
       let date = ISO8601DateFormatter().date(from: dueAt) {
        if date <= .now {
            return DueStatus(label: "Due now", urgency: .due)
        }
        let diffSeconds = Int(date.timeIntervalSinceNow)
        return DueStatus(label: "Due in \(formatDuration(diffSeconds))", urgency: .upcoming)
    }
    if card.learningStep != nil {
        return DueStatus(label: "Due now", urgency: .due)
    }
    return DueStatus(label: "New", urgency: .new)
}

func dueUrgencyColor(_ urgency: DueUrgency) -> Color {
    switch urgency {
    case .new: return .blue
    case .learning: return .red
    case .due: return .orange
    case .upcoming: return .green
    }
}

import SwiftUI
