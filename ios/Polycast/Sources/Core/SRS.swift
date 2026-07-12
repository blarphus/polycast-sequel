import Foundation

func parseISO8601Date(_ value: String) -> Date? {
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractionalFormatter.date(from: value) {
        return date
    }

    return ISO8601DateFormatter().date(from: value)
}

// MARK: - Prompt Type

/// Soft upper bound for the prompt-stage ladder, mirroring the server-side
/// `MAX_PROMPT_STAGE` in `server/lib/srsUpdate.js`. Used by the local
/// preview path to keep the client from drifting past the server's safety net.
let maxPromptStage = GeneratedSRSContract.maxPromptStage

/// Difficulty ladder, one rung per prompt_stage. Comprehension first, then
/// production; each stage removes exactly one crutch:
/// - meetWord: target sentence, word highlighted, picture — what does the word mean?
/// - sentenceMeaning: target sentence, word highlighted, NO picture — translate the sentence.
/// - wordProduction: native translation + picture — produce the target word.
/// - sentenceProduction: native sentence, word's translation highlighted, picture — produce the target sentence.
/// Pictures appear wherever the task is production (they pin down WHICH idea
/// is meant without giving away the target word) and on first meeting; they
/// are absent only when comprehension itself is what's being tested.
enum PromptType {
    case meetWord
    case sentenceMeaning
    case wordProduction
    case sentenceProduction
}

func getPromptType(card: SavedWord) -> PromptType {
    let stage = card.promptStage ?? 0
    if stage == 0 { return .meetWord }
    // sentenceMeaning asks for the sentence's translation, so the back needs
    // one to show as the answer.
    if stage == 1 {
        let pair = currentExample(for: card)
        return pair != nil ? .sentenceMeaning : .wordProduction
    }
    if stage == 2 { return .wordProduction }
    // Stage 3+ all use the same sentence-production layout; each card holds a
    // per-stage sentence pair so the same word appears in a fresh context
    // every time the user climbs a rung. If the pair for this stage isn't
    // ready yet (async generation in flight on the server), fall back to the
    // stage-2 layout per the FLASHCARDS.md fallback rules.
    return currentExample(for: card) != nil ? .sentenceProduction : .wordProduction
}

/// Look up the example-sentence pair that should be shown for the card's
/// current stage. For stages 0-3 the base `exampleSentence` / `sentenceTranslation`
/// columns are used (enrichment-time pair). For stages 4+ the matching entry
/// from `stageSentences` is returned. If an exact match isn't available
/// (e.g. the user has just advanced to a new high stage and the server-side
/// generation is still in flight) the highest available stage <= current is
/// used so the card at least renders something meaningful.
func currentExample(for card: SavedWord) -> (example: String, translation: String)? {
    let stage = card.promptStage ?? 0
    if stage <= 3 {
        let ex = card.exampleSentence ?? ""
        let tr = card.sentenceTranslation ?? ""
        guard !ex.isEmpty else { return nil }
        // For stages 0, 1, 3 the translation is needed; stage 2 has its own
        // production layout and does not require it. Match the original
        // server rules by returning the pair when both are present, and the
        // bare example otherwise (callers that need translation will detect
        // the empty string).
        return (ex, tr)
    }
    // Stage 4+
    let entries = (card.stageSentences ?? [])
        .filter { $0.stage <= stage }
        .sorted { $0.stage > $1.stage }
    guard let best = entries.first,
          !best.example.isEmpty,
          !best.translation.isEmpty
    else { return nil }
    return (best.example, best.translation)
}

func getInstructionText(_ promptType: PromptType) -> String {
    switch promptType {
    case .meetWord: return "What does the highlighted word mean?"
    case .sentenceMeaning: return "What does this sentence mean?"
    case .wordProduction: return "How do you say this?"
    case .sentenceProduction: return "How do you say this sentence?"
    }
}

// MARK: - SRS Algorithm

private let learningSteps = GeneratedSRSContract.learningSteps
private let graduatingInterval = GeneratedSRSContract.graduatingInterval
private let minReviewInterval = GeneratedSRSContract.minimumReviewInterval

private func roundedDayInterval(_ seconds: Double) -> Int {
    max(Int(round(seconds / Double(minReviewInterval))), 1) * minReviewInterval
}

// Binary rating: "again" (incorrect) or "good" (correct). Anything that is not
// "again" is treated as correct, matching the two-button UI.
func getNextDueSeconds(card: SavedWord, answer: String) -> Int {
    let isRelearning = card.learningStep != nil && card.srsInterval > 0
    let inLearning = !isRelearning && (card.learningStep != nil || card.srsInterval == 0)
    let incorrect = answer == "again"

    if isRelearning {
        let step = card.learningStep ?? 0
        if incorrect { return learningSteps[0] }
        // good advances through relearning steps, graduating off the last one.
        if step >= learningSteps.count - 1 { return card.srsInterval }
        return learningSteps[step + 1]
    }

    if inLearning {
        let step = card.learningStep ?? 0
        if incorrect { return learningSteps[0] }
        // good — advance a step, graduating off the last one.
        if step >= learningSteps.count - 1 { return graduatingInterval }
        return learningSteps[step + 1]
    }

    // Review phase
    let oldInterval = card.srsInterval
    let ease = card.easeFactor
    // again -> relearning; good -> grow the interval by the ease factor.
    return incorrect ? learningSteps[0] : roundedDayInterval(Double(oldInterval) * ease)
}

/// Locally advance a card's SRS state after an answer, mirroring the server
/// algorithm, so the study queue counts (new/learning/review) stay correct
/// even if the server response fails to arrive or decode.
enum StudyQueueBucket: Equatable {
    case new, learning, review
}

private func localDateKey(_ date: Date = .now, calendar: Calendar = .current) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
}

/// Classify a card by its direct status in the current local study day.
func studyQueueBucket(card: SavedWord, now: Date = .now, calendar: Calendar = .current) -> StudyQueueBucket {
    let today = localDateKey(now, calendar: calendar)
    if card.relearningDate == today { return .learning }
    // Ordinary learning steps remain in the blue queue for the local day on
    // which the card was introduced. A failed card is red via relearningDate.
    if isNewCard(card) || card.introducedDate == today { return .new }
    return .review
}

struct StudyQueueCounts: Equatable {
    var new: Int = 0
    var learning: Int = 0
    var review: Int = 0
}

func studyQueueCounts(cards: ArraySlice<SavedWord>, now: Date = .now, calendar: Calendar = .current) -> StudyQueueCounts {
    var counts = StudyQueueCounts()
    var seen = Set<String>()
    for card in cards {
        guard seen.insert(card.id).inserted else { continue }
        switch studyQueueBucket(card: card, now: now, calendar: calendar) {
        case .new: counts.new += 1
        case .learning: counts.learning += 1
        case .review: counts.review += 1
        }
    }
    return counts
}

/// Mirror of the server's prompt_stage rule: one stage up on correct, one
/// down on incorrect, clamped to a lower bound of 0 and a soft upper bound
/// of `maxPromptStage`. The ladder extends past stage 3 with one new example
/// sentence per rung.
func nextPromptStage(card: SavedWord, answer: String) -> Int {
    let stage = card.promptStage ?? 0
    if answer == "again" { return max(stage - 1, 0) }
    return min(stage + 1, maxPromptStage)
}

func applyAnswerLocally(card: SavedWord, answer: String, now: Date = .now, calendar: Calendar = .current) -> SavedWord {
    let isRelearning = card.learningStep != nil && card.srsInterval > 0
    let inLearning = !isRelearning && (card.learningStep != nil || card.srsInterval == 0)
    var newStep: Int?
    var newInterval = card.srsInterval
    var newEase = card.easeFactor
    let dueSeconds = getNextDueSeconds(card: card, answer: answer)

    let incorrect = answer == "again"

    if isRelearning {
        let step = card.learningStep ?? 0
        if incorrect {
            newStep = 0
        } else if step >= learningSteps.count - 1 {
            newStep = nil
        } else {
            newStep = step + 1
        }
    } else if inLearning {
        let step = card.learningStep ?? 0
        if incorrect {
            newStep = 0
        } else if step >= learningSteps.count - 1 {
            newStep = nil // graduates
            if card.srsInterval == 0 { newInterval = graduatingInterval }
        } else {
            newStep = step + 1
        }
    } else {
        // Review card: "again" enters relearning; "good" stays in review.
        newStep = incorrect ? 0 : nil
        if incorrect {
            newEase = max(newEase - 0.20, GeneratedSRSContract.minimumEaseFactor)
            newInterval = minReviewInterval
        } else {
            newInterval = dueSeconds
        }
    }

    let dueDate: Date
    if dueSeconds < minReviewInterval {
        dueDate = now.addingTimeInterval(TimeInterval(dueSeconds))
    } else {
        let dayCount = max(Int(round(Double(dueSeconds) / Double(minReviewInterval))), 1)
        dueDate = calendar.date(byAdding: .day, value: dayCount, to: calendar.startOfDay(for: now))!
    }
    let dueAt = ISO8601DateFormatter().string(from: dueDate)

    return SavedWord(
        id: card.id,
        word: card.word,
        translation: card.translation,
        definition: card.definition,
        targetLanguage: card.targetLanguage,
        sentenceContext: card.sentenceContext,
        createdAt: card.createdAt,
        frequency: card.frequency,
        frequencyCount: card.frequencyCount,
        exampleSentence: card.exampleSentence,
        sentenceTranslation: card.sentenceTranslation,
        partOfSpeech: card.partOfSpeech,
        srsInterval: newInterval,
        dueAt: dueAt,
        lastReviewedAt: ISO8601DateFormatter().string(from: now),
        correctCount: card.correctCount + (answer == "again" ? 0 : 1),
        incorrectCount: card.incorrectCount + (answer == "again" ? 1 : 0),
        easeFactor: newEase,
        learningStep: newStep,
        promptStage: nextPromptStage(card: card, answer: answer),
        imageUrl: card.imageUrl,
        lemma: card.lemma,
        forms: card.forms,
        priority: card.priority,
        imageTerm: card.imageTerm,
        queuePosition: card.queuePosition,
        introducedDate: card.introducedDate ?? (inLearning ? localDateKey(now, calendar: calendar) : nil),
        // Red means "last answer was wrong": clear the relearning mark on a
        // correct answer so a card failed-then-passed today turns green, not red.
        relearningDate: answer == "again" ? localDateKey(now, calendar: calendar) : nil,
        stageSentences: card.stageSentences
    )
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
    if let dueAt = card.dueAt,
       let date = parseISO8601Date(dueAt) {
        let isNew = isNewCard(card)
        if date <= .now {
            return DueStatus(label: isNew ? "New today" : "Due now", urgency: isNew ? .new : .due)
        }
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        let dueDay = calendar.startOfDay(for: date)
        let days = calendar.dateComponents([.day], from: today, to: dueDay).day ?? 0
        if isNew {
            if days == 1 { return DueStatus(label: "New tomorrow", urgency: .new) }
            return DueStatus(label: "New in \(max(days, 1)) d", urgency: .new)
        }
        let diffSeconds = max(Int(date.timeIntervalSinceNow), 0)
        return DueStatus(label: "Due in \(formatDuration(diffSeconds))", urgency: .upcoming)
    }
    if isNewCard(card) {
        return DueStatus(label: "Unscheduled", urgency: .upcoming)
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
