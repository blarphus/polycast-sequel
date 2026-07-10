import SwiftUI

struct DailyGoalCelebration: Identifiable, Equatable {
    let id = UUID()
    let completed: Bool
    let remaining: Int
    let added: Int
}

@MainActor
final class DailyWordGoalStore: ObservableObject {
    static let shared = DailyWordGoalStore()
    static let defaultGoal = 5

    @Published private(set) var addedToday = 0
    @Published private(set) var goal: Int
    @Published var celebration: DailyGoalCelebration?

    private let defaults = UserDefaults.standard
    private let goalKey = "polycast.dailyWordGoal"
    private let progressKey = "polycast.dailyWordProgress"
    private let dateKey = "polycast.dailyWordProgressDate"
    private var dismissalTask: Task<Void, Never>?

    private init() {
        let storedGoal = defaults.integer(forKey: goalKey)
        goal = storedGoal > 0 ? storedGoal : Self.defaultGoal
        if defaults.string(forKey: dateKey) == Self.todayKey() {
            addedToday = max(0, defaults.integer(forKey: progressKey))
        }
    }

    var remaining: Int { max(0, goal - addedToday) }
    var isComplete: Bool { addedToday >= goal }
    var progress: Double { min(1, Double(addedToday) / Double(max(goal, 1))) }

    func setGoal(_ value: Int) {
        goal = min(50, max(1, value))
        defaults.set(goal, forKey: goalKey)
    }

    func seed(_ count: Int) {
        addedToday = max(0, count)
        persistProgress()
    }

    func recordWordAdded() {
        resetForNewDayIfNeeded()
        let wasComplete = isComplete
        addedToday += 1
        persistProgress()
        showCelebration(completed: !wasComplete && isComplete)
    }

    private func resetForNewDayIfNeeded() {
        guard defaults.string(forKey: dateKey) != Self.todayKey() else { return }
        addedToday = 0
        persistProgress()
    }

    private func persistProgress() {
        defaults.set(Self.todayKey(), forKey: dateKey)
        defaults.set(addedToday, forKey: progressKey)
    }

    private func showCelebration(completed: Bool) {
        dismissalTask?.cancel()
        celebration = DailyGoalCelebration(
            completed: completed,
            remaining: remaining,
            added: addedToday
        )
        dismissalTask = Task {
            try? await Task.sleep(for: .seconds(completed ? 3.2 : 2.2))
            guard !Task.isCancelled else { return }
            celebration = nil
        }
    }

    private static func todayKey() -> String {
        let formatter = DateFormatter()
        formatter.calendar = .current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: .now)
    }
}

struct DailyGoalCelebrationView: View {
    let celebration: DailyGoalCelebration

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: celebration.completed ? "trophy.fill" : "checkmark")
                .font(.headline.bold())
                .foregroundStyle(celebration.completed ? .black : .white)
                .frame(width: 38, height: 38)
                .background(celebration.completed ? Color.yellow : Color.teal, in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(celebration.completed ? "Daily goal complete!" : "Word added")
                    .font(.subheadline.bold())
                Text(celebration.remaining == 0
                     ? "\(celebration.added) words added today"
                     : "\(celebration.remaining) more to reach today's goal")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(celebration.completed ? Color.yellow.opacity(0.7) : Color.teal.opacity(0.55))
        }
        .shadow(color: (celebration.completed ? Color.yellow : Color.teal).opacity(0.25), radius: 20, y: 8)
        .transition(.move(edge: .top).combined(with: .opacity).combined(with: .scale(scale: 0.96)))
        .accessibilityElement(children: .combine)
    }
}
