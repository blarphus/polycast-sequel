import SwiftUI

enum DictionarySortMode: String, CaseIterable {
    case queue = "Queue"
    case recent = "Recent"
    case alphabetical = "A-Z"
    case frequency = "Frequency"
    case dueSoonest = "Due"
}

private let wordsPerPage = 20

struct DictionaryView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore

    @State private var search = ""
    @State private var expandedKey: String?
    @State private var sortMode: DictionarySortMode = .queue
    @State private var showingLookup = false
    @State private var page = 0
    @State private var editingWord: SavedWord?
    @State private var deletingWord: SavedWord?
    @State private var groupedWords: [WordGroup] = []

    private var words: [SavedWord] { wordStore.words }
    private var loading: Bool { wordStore.loading }
    private var error: String { wordStore.error }

    var body: some View {
        VStack(spacing: 0) {
            listContent

            // Pagination lives OUTSIDE the List as a fixed footer. As a List row
            // its buttons stopped receiving taps once the page changed (a SwiftUI
            // hit-testing quirk for interactive controls in a scrolled List),
            // which froze paging past page 2.
            if totalPages > 1 {
                paginationControls
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 6)
            }
        }
            .searchable(text: $search, prompt: "Search saved words")
            .onChange(of: search) {
                rebuildGroups(resetPage: true)
            }
            .onChange(of: sortMode) {
                rebuildGroups(resetPage: true)
            }
            .onChange(of: words) {
                rebuildGroups()
            }
            .texturedBackground()
            .navigationTitle("Dictionary")
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar { toolbarContent }
            .sheet(isPresented: $showingLookup) {
                WordLookupView(
                    nativeLang: session.user?.nativeLanguage ?? "en",
                    targetLang: session.user?.targetLanguage ?? "en",
                    onSave: { saved in
                        wordStore.insert(saved)
                    }
                )
            }
            .sheet(item: $editingWord) { word in
                WordEditView(word: word) { updated in
                    wordStore.update(updated)
                }
            }
            .alert(
                "Delete Word",
                isPresented: Binding(
                    get: { deletingWord != nil },
                    set: { if !$0 { deletingWord = nil } }
                )
            ) {
                Button("Cancel", role: .cancel) { deletingWord = nil }
                Button("Delete", role: .destructive) {
                    if let word = deletingWord {
                        Task { await delete(word.id) }
                    }
                    deletingWord = nil
                }
            } message: {
                if let word = deletingWord {
                    Text("Are you sure you want to delete \"\(word.word)\"?")
                }
            }
            .overlay {
                if loading {
                    LoadingStateView(title: "Loading words...")
                }
            }
            .task {
                if groupedWords.isEmpty {
                    rebuildGroups()
                }
                if !loading {
                    if words.isEmpty || hasMissingSchedules {
                        await wordStore.load()
                    } else {
                        await wordStore.load(showLoading: false)
                    }
                }
            }
            .refreshable {
                await wordStore.load()
            }
    }

    private var hasMissingSchedules: Bool {
        words.contains { !isNewCard($0) && $0.dueAt == nil }
    }

    // MARK: - List Content

    private var listContent: some View {
        List {
            if !error.isEmpty {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                }
            }

            if !loading && !words.isEmpty {
                dueStatusSummary
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
            }

            ForEach(currentPageGroups, id: \.key) { group in
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        expandedKey = expandedKey == group.key ? nil : group.key
                    }
                } label: {
                    wordHeader(group: group)
                }
                .buttonStyle(.plain)
                .contentShape(Rectangle())
                .accessibilityIdentifier("dictionary-row-\(group.key)")
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))

                if expandedKey == group.key {
                    ForEach(group.entries) { word in
                        wordDetail(word: word)
                            .listRowInsets(EdgeInsets(top: 4, leading: 24, bottom: 4, trailing: 16))
                            .transition(.opacity.combined(with: .move(edge: .top)))
                            .swipeActions {
                                Button(role: .destructive) {
                                    Task { await delete(word.id) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                }
            }

        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showingLookup = true
            } label: {
                Image(systemName: "plus")
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Picker("Sort", selection: $sortMode) {
                    ForEach(DictionarySortMode.allCases, id: \.self) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
            } label: {
                Label("Sort", systemImage: "arrow.up.arrow.down")
            }
        }
    }

    // MARK: - Due Status Summary

    private var dueStatusSummary: some View {
        let newCount = words.filter { isNewCard($0) }.count
        let dueCount = words.filter { w in
            guard !isNewCard(w) else { return false }
            guard let dueAt = w.dueAt,
                  let date = parseISO8601Date(dueAt) else {
                return w.learningStep != nil && !isNewCard(w)
            }
            return date <= .now
        }.count

        let nextDue: Date? = words.compactMap { w in
            let date: Date?
            if isNewCard(w) {
                date = newCardDueDate(w)
            } else if let dueAt = w.dueAt {
                date = parseISO8601Date(dueAt)
            } else {
                date = nil
            }
            guard let date, date > .now else { return nil }
            return date
        }.min()

        return HStack(spacing: 16) {
            Label("\(dueCount) due", systemImage: "flame.fill")
                .font(.caption.weight(.medium))
                .foregroundStyle(dueCount > 0 ? .orange : .secondary)

            Label("\(newCount) new", systemImage: "plus.circle")
                .font(.caption.weight(.medium))
                .foregroundStyle(newCount > 0 ? .blue : .secondary)

            Spacer()

            if let nextDue {
                let seconds = Int(nextDue.timeIntervalSinceNow)
                Text("Next in \(formatDuration(seconds))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if dueCount == 0 && newCount == 0 {
                Text("All caught up")
                    .font(.caption)
                    .foregroundStyle(.green)
            }
        }
    }

    // MARK: - Word Header

    private func wordHeader(group: WordGroup) -> some View {
        let entry = group.primaryEntry
        let status = dictionaryDueStatus(entry)

        return HStack(spacing: 8) {
            Text(group.word)
                .font(.body.bold())
                .foregroundStyle(.tint)

            if let pos = entry.partOfSpeech, !pos.isEmpty {
                Text(pos.uppercased())
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(.secondary.opacity(0.15), in: Capsule())
                    .foregroundStyle(.secondary)
            }

            if group.entries.count > 1 {
                Text("\(group.entries.count)")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(.tint.opacity(0.15), in: Capsule())
                    .foregroundStyle(.tint)
            }

            Spacer()

            FrequencyDotsView(frequency: entry.frequency)

            Text(status.label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(dueUrgencyColor(status.urgency))

            Image(systemName: expandedKey == group.key ? "chevron.up" : "chevron.down")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
    }

    private func dictionaryDueStatus(_ word: SavedWord) -> DueStatus {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)

        if isNewCard(word), let date = newCardDueDate(word) {
            let dueDay = calendar.startOfDay(for: date)
            let days = calendar.dateComponents([.day], from: today, to: dueDay).day ?? 0
            if days <= 0 { return DueStatus(label: "New today", urgency: .new) }
            if days == 1 { return DueStatus(label: "New tomorrow", urgency: .new) }
            return DueStatus(label: "New in \(days) d", urgency: .new)
        }

        if let dueAt = word.dueAt, let date = parseISO8601Date(dueAt) {
            let dueDay = calendar.startOfDay(for: date)
            let days = calendar.dateComponents([.day], from: today, to: dueDay).day ?? 0
            if days <= 0 { return DueStatus(label: "Due now", urgency: .due) }
            if days == 1 { return DueStatus(label: "Due tomorrow", urgency: .upcoming) }
            return DueStatus(label: "Due in \(days) d", urgency: .upcoming)
        }

        return getDueStatus(word)
    }

    // MARK: - Word Detail

    private func wordDetail(word: SavedWord) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(word.translation)
                .font(.title3.weight(.medium))

            if !word.definition.isEmpty {
                Text(word.definition)
                    .font(.body)
                    .foregroundStyle(.secondary)
            }

            if let example = word.exampleSentence, !example.isEmpty {
                Text(renderTildeHighlight(example))
                    .font(.body)
                    .italic()
            }

            if let sentenceTranslation = word.sentenceTranslation, !sentenceTranslation.isEmpty {
                Text(sentenceTranslation)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if let url = APIClient.proxyImageURL(word.imageUrl) {
                AuthorizedAsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                            .frame(height: 160)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    default:
                        EmptyView()
                    }
                }
                .frame(height: 160)
            }

            HStack(spacing: 10) {
                if word.correctCount > 0 || word.incorrectCount > 0 {
                    Label("\(word.correctCount)/\(word.correctCount + word.incorrectCount)", systemImage: "checkmark.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                let scheduleText = reviewScheduleText(word)
                HStack(spacing: 4) {
                    Image(systemName: "clock")
                    Text(scheduleText)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("dictionary-schedule-\(word.id)")
                .accessibilityLabel(scheduleText)

                Spacer()

                Button {
                    editingWord = word
                } label: {
                    Label("Edit", systemImage: "pencil")
                        .font(.caption.weight(.medium))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                Button(role: .destructive) {
                    deletingWord = word
                } label: {
                    Image(systemName: "trash")
                        .font(.caption.weight(.medium))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
    }

    private func reviewScheduleText(_ word: SavedWord) -> String {
        func dueDateText(_ date: Date) -> String {
            let formatter = DateFormatter()
            formatter.dateStyle = .medium
            formatter.timeStyle = .none
            return formatter.string(from: date)
        }

        if isNewCard(word) {
            guard let dueDate = newCardDueDate(word) else { return "Queue pending" }
            let calendar = Calendar.current
            let today = calendar.startOfDay(for: .now)
            let dueDay = calendar.startOfDay(for: dueDate)
            let days = calendar.dateComponents([.day], from: today, to: dueDay).day ?? 0
            let dateText = dueDateText(dueDate)
            if days <= 0 { return "Next seen \(dateText) (today)" }
            if days == 1 { return "Next seen \(dateText) (tomorrow)" }
            return "Next seen \(dateText) (in \(days) days)"
        }

        guard let dueAt = word.dueAt,
              let dueDate = parseISO8601Date(dueAt),
              let reviewedAt = word.lastReviewedAt.flatMap({ parseISO8601Date($0) })
        else {
            return word.learningStep != nil ? "Learning schedule missing" : "Schedule missing"
        }

        let total = max(Int(dueDate.timeIntervalSince(reviewedAt)), 1)
        let elapsed = min(total, max(Int(Date().timeIntervalSince(reviewedAt)), 0))
        let remaining = max(Int(dueDate.timeIntervalSinceNow), 0)
        let prefix = remaining == 0 ? "Due now" : "Reappears in \(formatDuration(remaining))"
        return "\(prefix), \(dueDateText(dueDate)) · \(formatDuration(elapsed)) of \(formatDuration(total)) elapsed"
    }

    // MARK: - Pagination

    private var totalPages: Int {
        max(1, Int(ceil(Double(groupedWords.count) / Double(wordsPerPage))))
    }

    private var currentPageGroups: [WordGroup] {
        let all = groupedWords
        let start = page * wordsPerPage
        guard start < all.count else { return [] }
        let end = min(start + wordsPerPage, all.count)
        return Array(all[start..<end])
    }

    private var paginationControls: some View {
        HStack {
            Button {
                withAnimation { page = max(0, page - 1) }
            } label: {
                Label("Previous", systemImage: "chevron.left")
                    .font(.subheadline.weight(.medium))
            }
            .disabled(page == 0)

            Spacer()

            Text("Page \(page + 1) of \(totalPages)")
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer()

            Button {
                withAnimation { page = min(totalPages - 1, page + 1) }
            } label: {
                Label("Next", systemImage: "chevron.right")
                    .labelStyle(.trailingIcon)
                    .font(.subheadline.weight(.medium))
            }
            .disabled(page >= totalPages - 1)
        }
    }

    private func rebuildGroups(resetPage: Bool = false) {
        let nextGroups = makeSortedGroups()
        groupedWords = nextGroups
        if resetPage {
            page = 0
        }
        let maxPage = max(0, Int(ceil(Double(nextGroups.count) / Double(wordsPerPage))) - 1)
        if page > maxPage {
            page = maxPage
        }
    }

    // MARK: - Data

    private struct WordGroup: Identifiable {
        let key: String
        let word: String
        let entries: [SavedWord]
        var id: String { key }
        var primaryEntry: SavedWord { entries.first! }
    }

    private var dailyNewLimit: Int {
        max(session.user?.dailyNewLimit ?? 5, 0)
    }

    private var introducedTodayCount: Int {
        let todayKey = localDateKey()
        return words.filter { $0.introducedDate == todayKey }.count
    }

    private func localDateKey(_ date: Date = .now) -> String {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        guard let year = components.year,
              let month = components.month,
              let day = components.day else { return "" }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    private func newCardDueDate(_ word: SavedWord) -> Date? {
        newCardDueDate(word, dailyNewLimit: dailyNewLimit, introducedToday: introducedTodayCount)
    }

    private func newCardDueDate(_ word: SavedWord, dailyNewLimit limit: Int, introducedToday: Int) -> Date? {
        guard isNewCard(word),
              limit > 0,
              let queuePosition = word.queuePosition else { return nil }
        let today = Calendar.current.startOfDay(for: .now)
        let offset = max((queuePosition + introducedToday) / limit, 0)
        return Calendar.current.date(byAdding: .day, value: offset, to: today)
    }

    private func makeSortedGroups() -> [WordGroup] {
        let limit = dailyNewLimit
        let introducedToday = introducedTodayCount
        var dueCache: [String: Date] = [:]

        func cachedDueDay(_ word: SavedWord) -> Date {
            if let cached = dueCache[word.id] { return cached }
            let date: Date
            if isNewCard(word) {
                date = newCardDueDate(word, dailyNewLimit: limit, introducedToday: introducedToday) ?? .distantFuture
            } else if let dueAt = word.dueAt, let parsed = parseISO8601Date(dueAt) {
                date = Calendar.current.startOfDay(for: parsed)
            } else {
                date = .distantFuture
            }
            dueCache[word.id] = date
            return date
        }

        func exactDueTime(_ word: SavedWord) -> Date {
            if isNewCard(word) {
                return newCardDueDate(word, dailyNewLimit: limit, introducedToday: introducedToday) ?? .distantFuture
            }
            if let dueAt = word.dueAt, let parsed = parseISO8601Date(dueAt) {
                return parsed
            }
            return .distantFuture
        }

        func compareEntries(_ lhs: SavedWord, _ rhs: SavedWord) -> Bool {
            let lhsDueDay = cachedDueDay(lhs)
            let rhsDueDay = cachedDueDay(rhs)
            if lhsDueDay != rhsDueDay { return lhsDueDay < rhsDueDay }

            let lhsNew = isNewCard(lhs)
            let rhsNew = isNewCard(rhs)
            if lhsNew != rhsNew { return !lhsNew }

            let lhsLearning = lhs.learningStep != nil
            let rhsLearning = rhs.learningStep != nil
            if lhsLearning != rhsLearning { return lhsLearning }

            if lhsNew && rhsNew {
                let lhsQueue = lhs.queuePosition ?? Int.max
                let rhsQueue = rhs.queuePosition ?? Int.max
                if lhsQueue != rhsQueue { return lhsQueue < rhsQueue }
            } else {
                let lhsExactDue = exactDueTime(lhs)
                let rhsExactDue = exactDueTime(rhs)
                if lhsExactDue != rhsExactDue { return lhsExactDue < rhsExactDue }
            }

            if lhs.createdAt != rhs.createdAt { return lhs.createdAt > rhs.createdAt }
            return lhs.id < rhs.id
        }

        // Diacritic-insensitive match so "dano" finds "daño".
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).searchFolded()
        let filtered = words.filter {
            query.isEmpty ||
            $0.word.searchFolded().contains(query) ||
            $0.translation.searchFolded().contains(query)
        }

        let grouped = Dictionary(grouping: filtered, by: { "\($0.word)|\($0.targetLanguage ?? "")" })
        var groups = grouped.map { kv in
            WordGroup(
                key: kv.key,
                word: kv.value.first?.word ?? "",
                entries: kv.value.sorted(by: compareEntries)
            )
        }

        switch sortMode {
        case .queue:
            groups.sort { a, b in
                let aDueDay = cachedDueDay(a.primaryEntry)
                let bDueDay = cachedDueDay(b.primaryEntry)
                if aDueDay != bDueDay { return aDueDay < bDueDay }
                let aNew = isNewCard(a.primaryEntry)
                let bNew = isNewCard(b.primaryEntry)
                if aNew != bNew { return !aNew }
                let aQ = a.primaryEntry.queuePosition ?? Int.max
                let bQ = b.primaryEntry.queuePosition ?? Int.max
                if aQ != bQ { return aQ < bQ }
                let aExactDue = exactDueTime(a.primaryEntry)
                let bExactDue = exactDueTime(b.primaryEntry)
                if aExactDue != bExactDue { return aExactDue < bExactDue }
                let aF = a.primaryEntry.frequency ?? 0
                let bF = b.primaryEntry.frequency ?? 0
                if aF != bF { return bF < aF }
                return a.key < b.key
            }
        case .recent:
            groups.sort {
                if $0.primaryEntry.createdAt != $1.primaryEntry.createdAt {
                    return $0.primaryEntry.createdAt > $1.primaryEntry.createdAt
                }
                return $0.key < $1.key
            }
        case .alphabetical:
            groups.sort {
                let cmp = $0.word.localizedCaseInsensitiveCompare($1.word)
                if cmp != .orderedSame { return cmp == .orderedAscending }
                return $0.key < $1.key
            }
        case .frequency:
            groups.sort {
                let aF = $0.primaryEntry.frequency ?? 0
                let bF = $1.primaryEntry.frequency ?? 0
                if aF != bF { return aF > bF }
                return $0.key < $1.key
            }
        case .dueSoonest:
            groups.sort { a, b in
                let aDueDay = cachedDueDay(a.primaryEntry)
                let bDueDay = cachedDueDay(b.primaryEntry)
                if aDueDay != bDueDay { return aDueDay < bDueDay }
                let aNew = isNewCard(a.primaryEntry)
                let bNew = isNewCard(b.primaryEntry)
                if aNew != bNew { return !aNew }
                let aExactDue = exactDueTime(a.primaryEntry)
                let bExactDue = exactDueTime(b.primaryEntry)
                if aExactDue != bExactDue { return aExactDue < bExactDue }
                return a.key < b.key
            }
        }

        return groups
    }

    private func delete(_ id: String) async {
        do {
            try await APIClient.shared.deleteWord(id: id)
            wordStore.remove(id: id)
        } catch {
            PolycastLog.runtime.error("[Dictionary] Delete failed: \(error)")
        }
    }

}

// MARK: - Trailing Icon Label Style

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.title
            configuration.icon
        }
    }
}

extension LabelStyle where Self == TrailingIconLabelStyle {
    static var trailingIcon: TrailingIconLabelStyle { TrailingIconLabelStyle() }
}
