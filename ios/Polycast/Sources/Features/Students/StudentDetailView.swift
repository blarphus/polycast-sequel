import SwiftUI

struct StudentDetailView: View {
    let classroomId: String
    let studentId: String
    let studentName: String

    @State private var data: StudentDetailResponse?
    @State private var loading = true
    @State private var error = ""
    @State private var selectedDay: String?
    @State private var selectedDayItem: IdentifiableString?

    private let api = APIClient.shared

    var body: some View {
        Group {
            if loading {
                LoadingStateView(title: "Loading student data...")
                    .frame(maxHeight: .infinity)
            } else if !error.isEmpty {
                VStack(spacing: 12) {
                    Text(error)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                    Button("Retry") {
                        Task { await load() }
                    }
                    .buttonStyle(.bordered)
                    .tint(.purple)
                }
                .padding()
                .frame(maxHeight: .infinity)
            } else if let data {
                detailContent(data)
            }
        }
        .texturedBackground()
        .navigationTitle(studentName)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $selectedDayItem) { day in
            DayDetailSheet(day: day.value, activity: data?.activity ?? [])
        }
        .onChange(of: selectedDay) {
            selectedDayItem = selectedDay.map { IdentifiableString(value: $0) }
        }
    }

    // MARK: - Detail Content

    private func detailContent(_ data: StudentDetailResponse) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                profileHeader(data.student)
                keyMetrics(data.stats)
                heatmapSection(data)
                srsProgressSection(data.words)
                vocabularySection(data.words)
                recentSessionsSection(data.recentSessions)
                assignmentsSection(data.wordLists)
                summarySection(data.activity)
            }
            .padding(.vertical)
        }
    }

    // MARK: - Profile Header

    private func profileHeader(_ student: StudentDetailResponse.StudentInfo) -> some View {
        HStack(spacing: 16) {
            let name = student.displayName ?? student.username
            let initials = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
            let display = initials.isEmpty ? String(name.prefix(1)).uppercased() : initials.uppercased()

            Text(display)
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(Color.purple.opacity(0.7), in: Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(student.displayName ?? student.username)
                    .font(.title2.weight(.bold))
                Text("@\(student.username)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(.horizontal)
    }

    // MARK: - Key Metrics

    private func keyMetrics(_ stats: StudentStats) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
            metricCard(value: "\(stats.streak)", label: "Day streak", accent: true)
            metricCard(value: "\(stats.totalWords)", label: "Total words")
            metricCard(value: "\(stats.wordsMastered)", label: "Mastered")
            metricCard(value: pct(stats.accuracy), label: "Accuracy")
            metricCard(value: "\(stats.wordsDue)", label: "Due now")
            metricCard(value: "\(stats.daysActiveThisWeek)", label: "Active days")
        }
        .padding(.horizontal)
    }

    private func metricCard(value: String, label: String, accent: Bool = false) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2.weight(.bold))
                .foregroundStyle(accent ? Color.purple : .primary)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - 30-Day Heatmap

    private func heatmapSection(_ data: StudentDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Last 30 Days")
                .padding(.horizontal)

            let activityMap = Dictionary(uniqueKeysWithValues: data.activity.map { ($0.day, $0) })
            let today = Date()
            let createdStr = data.student.createdAt.prefix(10)

            // Build calendar cells
            let cells: [(date: String, weekday: Int, dayNum: Int, status: DayStatus)] = (0..<30).reversed().map { offset in
                let d = Calendar.current.date(byAdding: .day, value: -offset, to: today)!
                let dateStr = formatDateISO(d)
                let weekday = Calendar.current.component(.weekday, from: d) - 1 // 0=Sun
                let dayNum = Calendar.current.component(.day, from: d)
                let beforeAccount = dateStr < String(createdStr)
                let activity = activityMap[dateStr]
                return (dateStr, weekday, dayNum, dayStatus(activity, beforeAccount: beforeAccount))
            }

            VStack(spacing: 4) {
                // Day headers
                HStack(spacing: 0) {
                    ForEach(["S", "M", "T", "W", "T", "F", "S"], id: \.self) { day in
                        Text(day)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                    }
                }

                // Build rows
                let rows = buildCalendarRows(cells)
                ForEach(0..<rows.count, id: \.self) { rowIndex in
                    HStack(spacing: 0) {
                        ForEach(0..<7, id: \.self) { col in
                            if let cell = rows[rowIndex][col] {
                                Button {
                                    if cell.status != .inactive {
                                        selectedDay = selectedDay == cell.date ? nil : cell.date
                                    }
                                } label: {
                                    Text("\(cell.dayNum)")
                                        .font(.caption2)
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 32)
                                        .background(heatmapColor(cell.status, selected: selectedDay == cell.date))
                                        .clipShape(RoundedRectangle(cornerRadius: 6))
                                }
                                .buttonStyle(.plain)
                                .disabled(cell.status == .inactive)
                            } else {
                                Color.clear
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 32)
                            }
                        }
                    }
                }

                // Legend
                HStack(spacing: 12) {
                    heatmapLegendItem(color: .green, label: "Reviewed")
                    heatmapLegendItem(color: .orange, label: "Some activity")
                    heatmapLegendItem(color: Color(.systemGray4), label: "Skipped")
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
            }
            .padding()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
        }
    }

    private func heatmapLegendItem(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 3)
                .fill(color.opacity(0.5))
                .frame(width: 12, height: 12)
            Text(label)
        }
    }

    // MARK: - SRS Progress

    private func srsProgressSection(_ words: [StudentWord]) -> some View {
        guard !words.isEmpty else { return AnyView(EmptyView()) }

        let total = words.count
        var counts: [String: Int] = ["mastered": 0, "review": 0, "learning": 0, "new": 0]
        for w in words { counts[w.srsStage, default: 0] += 1 }

        let segments: [(stage: String, count: Int, color: Color, label: String)] = [
            ("mastered", counts["mastered"]!, .green, "Mastered"),
            ("review", counts["review"]!, .blue, "Review"),
            ("learning", counts["learning"]!, .orange, "Learning"),
            ("new", counts["new"]!, Color(.systemGray3), "New"),
        ]

        return AnyView(
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader("SRS Progress")
                    .padding(.horizontal)

                VStack(spacing: 8) {
                    GeometryReader { geo in
                        HStack(spacing: 2) {
                            ForEach(segments.filter { $0.count > 0 }, id: \.stage) { seg in
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(seg.color)
                                    .frame(width: max(4, geo.size.width * CGFloat(seg.count) / CGFloat(total)))
                            }
                        }
                    }
                    .frame(height: 12)

                    HStack(spacing: 16) {
                        ForEach(segments, id: \.stage) { seg in
                            HStack(spacing: 4) {
                                Circle()
                                    .fill(seg.color)
                                    .frame(width: 8, height: 8)
                                Text("\(seg.count) \(seg.label.lowercased())")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .padding()
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)
            }
        )
    }

    // MARK: - Vocabulary

    private func vocabularySection(_ words: [StudentWord]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Vocabulary", subtitle: "\(words.count) words")
                .padding(.horizontal)

            if words.isEmpty {
                EmptyStateView(title: "No words saved yet", subtitle: nil)
                    .padding(.horizontal)
            } else {
                VStack(spacing: 0) {
                    // Header
                    HStack {
                        Text("Word").font(.caption.weight(.semibold))
                        Spacer()
                        Text("Translation").font(.caption.weight(.semibold))
                        Spacer()
                        Text("Stage").font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
                    .padding(.vertical, 8)

                    Divider()

                    ForEach(words.prefix(20)) { word in
                        HStack {
                            Text(word.word)
                                .font(.subheadline)
                                .lineLimit(1)
                            Spacer()
                            Text(word.translation)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            Spacer()
                            stageChip(word.srsStage)
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 6)

                        if word.id != words.prefix(20).last?.id {
                            Divider().padding(.leading)
                        }
                    }

                    if words.count > 20 {
                        Text("+\(words.count - 20) more words")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 8)
                    }
                }
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)
            }
        }
    }

    private func stageChip(_ stage: String) -> some View {
        let color: Color = switch stage {
        case "mastered": .green
        case "review": .blue
        case "learning": .orange
        default: Color(.systemGray3)
        }
        return Chip(text: stage, color: color)
    }

    // MARK: - Recent Sessions

    private func recentSessionsSection(_ sessions: [RecentSession]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Recent Tests & Practice")
                .padding(.horizontal)

            if sessions.isEmpty {
                EmptyStateView(title: "No sessions yet", subtitle: nil)
                    .padding(.horizontal)
            } else {
                VStack(spacing: 0) {
                    ForEach(sessions) { session in
                        HStack(spacing: 12) {
                            sessionBadge(session.type)

                            VStack(alignment: .leading, spacing: 2) {
                                let score = session.questionCount > 0
                                    ? Int(Double(session.correctCount) / Double(session.questionCount) * 100)
                                    : 0
                                Text("\(score)%")
                                    .font(.subheadline.weight(.semibold))
                                HStack(spacing: 4) {
                                    Text("\(session.correctCount)/\(session.questionCount)")
                                    if let dur = session.durationSeconds {
                                        Text("in \(formatSessionDuration(dur))")
                                    }
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }

                            Spacer()

                            Text(formatRelativeTime(session.doneAt))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 10)

                        if session.id != sessions.last?.id {
                            Divider().padding(.leading, 56)
                        }
                    }
                }
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)
            }
        }
    }

    private func sessionBadge(_ type: String) -> some View {
        let (label, color): (String, Color) = switch type {
        case "quiz": ("Quiz", .indigo)
        case "drill": ("Drill", .orange)
        case "voice": ("Voice", .cyan)
        default: (type.capitalized, .gray)
        }
        return Text(label)
            .font(.caption2.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color, in: Capsule())
    }

    // MARK: - Assignments

    private func assignmentsSection(_ wordLists: [StudentWordList]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            let completed = wordLists.filter(\.completed).count
            SectionHeader(
                "Assignments",
                subtitle: wordLists.isEmpty ? nil : "\(completed)/\(wordLists.count) completed"
            )
            .padding(.horizontal)

            if wordLists.isEmpty {
                EmptyStateView(title: "No assignments yet", subtitle: nil)
                    .padding(.horizontal)
            } else {
                VStack(spacing: 0) {
                    ForEach(wordLists) { wl in
                        HStack(spacing: 12) {
                            if wl.completed {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else {
                                Image(systemName: "circle")
                                    .foregroundStyle(.secondary)
                            }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(wl.title.isEmpty ? "Word List" : wl.title)
                                    .font(.subheadline.weight(.medium))
                                HStack(spacing: 4) {
                                    Text("\(wl.wordCount) word\(wl.wordCount == 1 ? "" : "s")")
                                    if let completedAt = wl.completedAt {
                                        Text("-- completed \(formatShortDate(completedAt))")
                                    }
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }

                            Spacer()
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 10)

                        if wl.id != wordLists.last?.id {
                            Divider().padding(.leading, 44)
                        }
                    }
                }
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal)
            }
        }
    }

    // MARK: - 90-Day Summary

    private func summarySection(_ activity: [DailyActivity]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("90-Day Summary")
                .padding(.horizontal)

            let reviews = activity.reduce(0) { $0 + $1.reviews }
            let wordsAdded = activity.reduce(0) { $0 + $1.wordsAdded }
            let quizzes = activity.reduce(0) { $0 + $1.quizzes }
            let drills = activity.reduce(0) { $0 + $1.drills }
            let voiceSessions = activity.reduce(0) { $0 + $1.voiceSessions }

            VStack(spacing: 0) {
                summaryRow(label: "Reviews", value: "\(reviews)")
                Divider()
                summaryRow(label: "Words added", value: "\(wordsAdded)")
                Divider()
                summaryRow(label: "Quizzes", value: "\(quizzes)")
                Divider()
                summaryRow(label: "Drills", value: "\(drills)")
                Divider()
                summaryRow(label: "Voice practice", value: "\(voiceSessions)")
            }
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
        }
    }

    private func summaryRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    // MARK: - Data Loading

    private func load() async {
        loading = data == nil
        do {
            let result = try await api.getStudentStats(classroomId: classroomId, studentId: studentId)
            data = result
            error = ""
        } catch {
            self.error = error.localizedDescription
            print("[Polycast] StudentDetailView load error: \(error)")
        }
        loading = false
    }
}

// MARK: - Helper Types & Functions

private struct IdentifiableString: Identifiable {
    let value: String
    var id: String { value }
}

private enum DayStatus {
    case completed, partial, skipped, inactive
}

private func dayStatus(_ activity: DailyActivity?, beforeAccount: Bool) -> DayStatus {
    if beforeAccount { return .inactive }
    guard let a = activity else { return .skipped }
    if a.reviews > 0 { return .completed }
    let total = a.reviews + a.wordsAdded + a.quizzes + a.drills + a.voiceSessions
    if total > 0 { return .partial }
    return .skipped
}

private func heatmapColor(_ status: DayStatus, selected: Bool) -> Color {
    let base: Color = switch status {
    case .completed: .green
    case .partial: .orange
    case .skipped: Color(.systemGray4)
    case .inactive: Color(.systemGray6)
    }
    return base.opacity(selected ? 0.8 : 0.35)
}

private struct CalendarCell {
    let date: String
    let dayNum: Int
    let status: DayStatus
}

private func buildCalendarRows(_ cells: [(date: String, weekday: Int, dayNum: Int, status: DayStatus)]) -> [[CalendarCell?]] {
    var rows: [[CalendarCell?]] = []
    var row: [CalendarCell?] = Array(repeating: nil, count: 7)
    for cell in cells {
        row[cell.weekday] = CalendarCell(date: cell.date, dayNum: cell.dayNum, status: cell.status)
        if cell.weekday == 6 {
            rows.append(row)
            row = Array(repeating: nil, count: 7)
        }
    }
    if row.contains(where: { $0 != nil }) {
        rows.append(row)
    }
    return rows
}

private func formatDateISO(_ date: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
}

private func pct(_ value: Double?) -> String {
    guard let value else { return "--" }
    return "\(Int(value * 100))%"
}

private func formatSessionDuration(_ seconds: Int) -> String {
    if seconds < 60 { return "\(seconds)s" }
    return "\(seconds / 60)m \(seconds % 60)s"
}

private func formatRelativeTime(_ isoString: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: isoString) ?? ISO8601DateFormatter().date(from: isoString) else { return "" }

    let seconds = -date.timeIntervalSinceNow
    if seconds < 60 { return "now" }
    if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
    if seconds < 86400 { return "\(Int(seconds / 3600))h ago" }
    if seconds < 172800 { return "yesterday" }
    if seconds < 604800 { return "\(Int(seconds / 86400))d ago" }
    return formatShortDate(isoString)
}

private func formatShortDate(_ isoString: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: isoString) ?? ISO8601DateFormatter().date(from: isoString) else { return "" }
    let df = DateFormatter()
    df.dateFormat = "MMM d"
    return df.string(from: date)
}

// MARK: - Day Detail Sheet

private struct DayDetailSheet: View {
    let day: String
    let activity: [DailyActivity]

    @Environment(\.dismiss) private var dismiss

    private var data: DailyActivity? {
        activity.first { $0.day == day }
    }

    private var dateLabel: String {
        let date = Date(isoDate: day)
        let df = DateFormatter()
        df.dateFormat = "EEEE, MMMM d"
        return df.string(from: date)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let data, totalActivity(data) > 0 {
                        // Stats
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 12) {
                            if data.reviews > 0 { statItem(value: "\(data.reviews)", label: "Reviews") }
                            if data.wordsAdded > 0 { statItem(value: "\(data.wordsAdded)", label: "Words added") }
                            if data.quizzes > 0 { statItem(value: "\(data.quizCorrect)/\(data.quizTotal)", label: "Quiz\(data.quizzes > 1 ? "zes" : "")") }
                            if data.drills > 0 { statItem(value: "\(data.drills)", label: "Drill\(data.drills > 1 ? "s" : "")") }
                            if data.voiceSessions > 0 { statItem(value: "\(data.voiceSessions)", label: "Voice") }
                        }

                        let reviewed = data.words.filter { $0.action == "reviewed" }
                        let added = data.words.filter { $0.action == "added" }
                        let uniqueReviewed = Array(Dictionary(grouping: reviewed, by: \.word).compactMapValues(\.first).values)

                        if !uniqueReviewed.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Words reviewed (\(uniqueReviewed.count))")
                                    .font(.headline)
                                ForEach(uniqueReviewed, id: \.word) { w in
                                    HStack {
                                        Text(w.word).font(.subheadline)
                                        Spacer()
                                        Text(w.translation).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        if !added.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Words added (\(added.count))")
                                    .font(.headline)
                                ForEach(added, id: \.word) { w in
                                    HStack {
                                        Text(w.word).font(.subheadline)
                                        Spacer()
                                        Text(w.translation).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    } else {
                        Text("No activity on this day.")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding()
            }
            .texturedBackground()
            .navigationTitle(dateLabel)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func statItem(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.title3.weight(.bold))
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private func totalActivity(_ d: DailyActivity) -> Int {
        d.reviews + d.wordsAdded + d.quizzes + d.drills + d.voiceSessions
    }
}

private extension Date {
    init(isoDate: String) {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        self = f.date(from: isoDate) ?? Date()
    }
}
