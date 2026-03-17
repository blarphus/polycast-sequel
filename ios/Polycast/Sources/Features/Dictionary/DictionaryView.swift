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

    private var words: [SavedWord] { wordStore.words }
    private var loading: Bool { wordStore.loading }
    private var error: String { wordStore.error }

    var body: some View {
        listContent
            .listStyle(.plain)
            .searchable(text: $search, prompt: "Search saved words")
            .onChange(of: search) { page = 0 }
            .onChange(of: sortMode) { page = 0 }
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
                if words.isEmpty && !loading {
                    await wordStore.load()
                }
            }
            .refreshable {
                await wordStore.load()
            }
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

            if totalPages > 1 {
                paginationControls
                    .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                    .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
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
            guard let dueAt = w.dueAt,
                  let date = ISO8601DateFormatter().date(from: dueAt) else {
                return w.learningStep != nil && !isNewCard(w)
            }
            return date <= .now
        }.count

        let nextDue: Date? = words.compactMap { w in
            guard let dueAt = w.dueAt,
                  let date = ISO8601DateFormatter().date(from: dueAt),
                  date > .now else { return nil }
            return date
        }.min()

        return HStack(spacing: 16) {
            Label("\(dueCount) due", systemImage: "flame.fill")
                .font(.caption.weight(.medium))
                .foregroundStyle(dueCount > 0 ? .orange : .secondary)

            Label("\(newCount) new", systemImage: "sparkles")
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
        let status = getDueStatus(entry)

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
                AsyncImage(url: url) { phase in
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
                if word.srsInterval > 0 {
                    Label(formatDuration(word.srsInterval), systemImage: "clock")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

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

    // MARK: - Pagination

    private var totalPages: Int {
        max(1, Int(ceil(Double(sortedGroups.count) / Double(wordsPerPage))))
    }

    private var currentPageGroups: [WordGroup] {
        let all = sortedGroups
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

    // MARK: - Data

    private struct WordGroup: Identifiable {
        let key: String
        let word: String
        let entries: [SavedWord]
        var id: String { key }
        var primaryEntry: SavedWord { entries.first! }
    }

    private var sortedGroups: [WordGroup] {
        let filtered = words.filter {
            search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            $0.word.localizedCaseInsensitiveContains(search) ||
            $0.translation.localizedCaseInsensitiveContains(search)
        }

        let grouped = Dictionary(grouping: filtered, by: { "\($0.word)|\($0.targetLanguage ?? "")" })
        var groups = grouped.map { kv in
            WordGroup(
                key: kv.key,
                word: kv.value.first?.word ?? "",
                entries: kv.value.sorted { $0.createdAt > $1.createdAt }
            )
        }

        switch sortMode {
        case .queue:
            groups.sort { a, b in
                let aNew = isNewCard(a.primaryEntry)
                let bNew = isNewCard(b.primaryEntry)
                if aNew != bNew { return aNew }
                let aQ = a.primaryEntry.queuePosition ?? Int.max
                let bQ = b.primaryEntry.queuePosition ?? Int.max
                if aQ != bQ { return aQ < bQ }
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
                let aNew = isNewCard(a.primaryEntry)
                let bNew = isNewCard(b.primaryEntry)
                if aNew != bNew { return aNew }
                let aDue = a.primaryEntry.dueAt ?? ""
                let bDue = b.primaryEntry.dueAt ?? ""
                if aDue != bDue { return aDue < bDue }
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
            print("[Dictionary] Delete failed: \(error)")
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
