import SwiftUI
import WidgetKit

extension LearnView {
    var introView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Today's Practice")
                    .font(.largeTitle.bold())

                if loadingOverview {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 320)
                } else if let overview {
                    practiceTotalCard(overview)

                    if !selectedPreviewWords.isEmpty {
                        newWordsCarousel
                    }

                    Button {
                        Task { await startSession() }
                    } label: {
                        HStack {
                            if startingSession {
                                ProgressView().tint(.white)
                            } else {
                                Text("Start practice")
                                Spacer()
                                Text("\(overview.due + newWordsCount) cards")
                                    .fontWeight(.semibold)
                                    .opacity(0.85)
                            }
                        }
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.purple)
                    .controlSize(.large)
                    .disabled(startingSession || overview.due + newWordsCount == 0)
                } else {
                    EmptyStateView(title: "Could not load your queue.", subtitle: error)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .texturedBackground()
    }

    func practiceTotalCard(_ overview: StudyOverview) -> some View {
        let total = overview.due + newWordsCount

        return VStack(alignment: .leading, spacing: 2) {
            Text("\(total)")
                .font(.system(size: 80, weight: .heavy, design: .rounded))
                .contentTransition(.numericText())
            Text(total == 1 ? "card due today" : "cards due today")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.secondary)
            (
                Text("\(overview.due)").foregroundStyle(.blue) + Text(" review")
                + Text("  ·  ").foregroundStyle(.secondary)
                + Text("\(newWordsCount)").foregroundStyle(.green) + Text(" new")
            )
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.secondary)
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(total) cards due today, including \(overview.due) review and \(newWordsCount) new")
        .accessibilityIdentifier("cards-due-today")
    }


    var newWordsCarousel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("New words for today")
                    .font(.title3.bold())
                Spacer()
                Text("Swipe to preview")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 14) {
                    ForEach(selectedPreviewWords) { word in
                        newWordPreviewCard(word)
                            .containerRelativeFrame(.horizontal, count: 1, spacing: 14)
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, 0, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $carouselScrollID)
            .overlay(alignment: .leading) {
                if selectedPreviewWords.count > 1 {
                    carouselArrow("chevron.left", step: -1)
                }
            }
            .overlay(alignment: .trailing) {
                if selectedPreviewWords.count > 1 {
                    carouselArrow("chevron.right", step: 1)
                }
            }
        }
    }

    func carouselArrow(_ systemName: String, step: Int) -> some View {
        Button {
            let ids = selectedPreviewWords.map(\.id)
            guard !ids.isEmpty else { return }
            let current = carouselScrollID.flatMap { ids.firstIndex(of: $0) } ?? 0
            let target = min(max(current + step, 0), ids.count - 1)
            withAnimation { carouselScrollID = ids[target] }
        } label: {
            Image(systemName: systemName)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.purple)
                .padding(9)
                .background(.regularMaterial, in: Circle())
                .overlay { Circle().stroke(.primary.opacity(0.08), lineWidth: 1) }
                .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
                .padding(.horizontal, 8)
        }
        .buttonStyle(.plain)
    }

    func newWordPreviewCard(_ word: SavedWord) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(word.word)
                    .font(.title2.bold())
                    .lineLimit(1)
                Text(word.translation)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            previewImage(for: word)
        }
        .padding(14)
        .background(.background.opacity(0.82), in: RoundedRectangle(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22)
                .stroke(.primary.opacity(0.08), lineWidth: 1)
        }
    }

    @ViewBuilder
    func previewImage(for word: SavedWord) -> some View {
        if let url = APIClient.proxyImageURL(word.imageUrl) {
            AuthorizedAsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                case .failure:
                    previewImagePlaceholder
                default:
                    ZStack {
                        previewImagePlaceholder
                        ProgressView()
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 154)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        } else {
            previewImagePlaceholder
                .frame(height: 154)
        }
    }

    var previewImagePlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: [.purple.opacity(0.18), .indigo.opacity(0.08)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 28))
                .foregroundStyle(.purple.opacity(0.7))
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    func wordCountControl(value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        HStack(spacing: 18) {
            Button {
                value.wrappedValue = max(range.lowerBound, value.wrappedValue - 1)
            } label: {
                Image(systemName: "minus")
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.bordered)
            .clipShape(Circle())
            .disabled(value.wrappedValue <= range.lowerBound)

            Text("\(value.wrappedValue)")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .frame(minWidth: 54)
                .accessibilityIdentifier("new-words-count")

            Button {
                value.wrappedValue = min(range.upperBound, value.wrappedValue + 1)
            } label: {
                Image(systemName: "plus")
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
            .clipShape(Circle())
            .disabled(value.wrappedValue >= range.upperBound)
        }
        .frame(maxWidth: .infinity)
    }

    @discardableResult
    func restoreCachedOverview() -> Bool {
        guard let snapshot = PracticeStartCache.freshSnapshot else { return false }
        overview = snapshot.overview
        previewWords = snapshot.previewWords
        newWordsCount = snapshot.newWordsCount
        loadingOverview = false
        return true
    }

    func loadOverview(force: Bool = false) async {
        if !force, restoreCachedOverview() {
            return
        }

        loadingOverview = true
        do {
            let ov = try await APIClient.shared.studyOverview()
            let count = min(ov.dailyNewLimit, min(ov.newAvailable, 50))
            overview = ov
            previewWords = []
            newWordsCount = count
            PracticeStartCache.snapshot = PracticeStartSnapshot(
                overview: ov,
                previewWords: [],
                newWordsCount: count,
                savedAt: .now
            )
            WidgetCenter.shared.reloadAllTimelines()
            loadingOverview = false
            Task { await loadPreviewImages(limit: count) }
        } catch {
            self.error = error.localizedDescription
            loadingOverview = false
        }
    }

    func loadPreviewImages(limit: Int) async {
        guard limit > 0 else { return }

        do {
            let words = try await APIClient.shared.newWordPreview(limit: limit)
            let upcomingWords = upcomingNewWords(from: words)
            previewWords = upcomingWords
            wordStore.upsert(contentsOf: words)
            PracticeStartCache.snapshot = PracticeStartSnapshot(
                overview: overview ?? StudyOverview(due: 0, newAvailable: 0, dailyNewLimit: limit),
                previewWords: upcomingWords,
                newWordsCount: newWordsCount,
                savedAt: .now
            )
            refreshTodayWordsWidgetPreview()
            // The start-screen preview warms images only. Audio preloading starts
            // after the learner begins an actual flashcard session.
            prefetchWordImages(upcomingWords.prefix(newWordsCount).compactMap { APIClient.proxyImageURL($0.imageUrl) })
        } catch {
            PolycastLog.runtime.error("[Polycast] Failed to load practice preview images: \(error)")
        }
    }

    func refreshTodayWordsWidgetPreview() {
        Task {
            do {
                let snapshot = try await APIClient.shared.todayWordsWidgetSnapshot()
                TodayWordsWidgetStore.saveSnapshot(snapshot)
                await APIClient.shared.cacheTodayWordsWidgetImages(for: snapshot)
                WidgetCenter.shared.reloadAllTimelines()
            } catch {
                PolycastLog.runtime.error("[Polycast] Failed to refresh practice widget preview: \(error)")
            }
        }
    }

    func startSession() async {
        startingSession = true
        PracticeStartCache.snapshot = nil
        // Persist the chosen daily new-word count if it changed.
        if let overview, newWordsCount != overview.dailyNewLimit, let user = session.user {
            _ = await session.updateSettings(
                nativeLanguage: user.nativeLanguage,
                targetLanguage: user.targetLanguage,
                dailyNewLimit: newWordsCount,
                accountType: user.accountType,
                cefrLevel: user.cefrLevel
            )
        }
        sessionNewWordLimit = newWordsCount
        sessionStart = .now
        await loadInitialSession()
        started = true
        startingSession = false
        if !cards.isEmpty {
            preloadUpcomingAudio(from: currentIndex)
            prefetchUpcomingImages(from: 0)
            autoPlayIfNeeded()
            Task { await loadRemainingSession(startingAfter: cards.count) }
        }
    }

    // MARK: - Gradients

    func cardGradient(promptType: PromptType, isBack: Bool) -> LinearGradient {
        let isDark = colorScheme == .dark
        if isBack {
            return isDark
                ? LinearGradient(colors: [Color(red: 0.12, green: 0.2, blue: 0.15), Color(red: 0.1, green: 0.18, blue: 0.13)], startPoint: .topLeading, endPoint: .bottomTrailing)
                : LinearGradient(colors: [Color(red: 0.93, green: 1.0, blue: 0.96), Color(red: 0.85, green: 0.96, blue: 0.88)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        switch promptType {
        case .meetWord, .wordProduction:
            return isDark
                ? LinearGradient(colors: [Color(red: 0.12, green: 0.14, blue: 0.25), Color(red: 0.1, green: 0.12, blue: 0.22)], startPoint: .topLeading, endPoint: .bottomTrailing)
                : LinearGradient(colors: [Color(red: 0.88, green: 0.92, blue: 1.0), Color(red: 0.78, green: 0.85, blue: 0.99)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .sentenceMeaning, .sentenceProduction:
            return isDark
                ? LinearGradient(colors: [Color(red: 0.16, green: 0.12, blue: 0.22), Color(red: 0.14, green: 0.1, blue: 0.2)], startPoint: .topLeading, endPoint: .bottomTrailing)
                : LinearGradient(colors: [Color(red: 0.95, green: 0.93, blue: 1.0), Color(red: 0.88, green: 0.85, blue: 0.98)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    func cardBorderColor(promptType: PromptType, isBack: Bool) -> Color {
        let isDark = colorScheme == .dark
        if isBack {
            return isDark ? Color(red: 0.2, green: 0.35, blue: 0.25) : Color(red: 0.75, green: 0.9, blue: 0.8)
        }
        switch promptType {
        case .meetWord, .wordProduction:
            return isDark ? Color(red: 0.2, green: 0.25, blue: 0.4) : Color(red: 0.7, green: 0.78, blue: 0.95)
        case .sentenceMeaning, .sentenceProduction:
            return isDark ? Color(red: 0.28, green: 0.2, blue: 0.38) : Color(red: 0.82, green: 0.78, blue: 0.95)
        }
    }

    // MARK: - Session Complete

    var maxAdditionalNewWords: Int {
        min(completionOverview?.newAvailable ?? 0, max(0, 50 - sessionNewWordLimit))
    }

    var sessionCompleteView: some View {
        let duration = Int(Date().timeIntervalSince(sessionStart))
        let mins = duration / 60
        let secs = duration % 60
        let accuracy = sessionStats.reviewed > 0
            ? Int(round(Double(sessionStats.correct) / Double(sessionStats.reviewed) * 100))
            : 0

        return ScrollView {
            VStack(spacing: 24) {
                ZStack {
                    Circle()
                        .fill(.green.opacity(0.14))
                        .frame(width: 112, height: 112)
                    Image(systemName: "checkmark")
                        .font(.system(size: 48, weight: .bold))
                        .foregroundStyle(.green)
                }

                VStack(spacing: 8) {
                    Text("Flashcards all done for today")
                        .font(.largeTitle.bold())
                        .multilineTextAlignment(.center)
                    Text("You cleared every card in today's practice.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                HStack(spacing: 0) {
                    statItem(value: "\(sessionStats.reviewed)", label: "Reviewed")
                    Divider().frame(height: 44)
                    statItem(value: "\(accuracy)%", label: "Accuracy")
                    Divider().frame(height: 44)
                    statItem(value: mins > 0 ? "\(mins)m \(secs)s" : "\(secs)s", label: "Time")
                }
                .padding(.vertical, 18)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22))

                if loadingCompletionOptions {
                    ProgressView("Checking for more new words...")
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else if maxAdditionalNewWords > 0 {
                    VStack(alignment: .leading, spacing: 16) {
                        Label("Keep going with new words", systemImage: "plus.circle")
                            .font(.headline)
                            .foregroundStyle(.purple)

                        Text("Increase today's new-word count without changing your usual daily goal.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        wordCountControl(value: $additionalNewWords, range: 1...maxAdditionalNewWords)

                        Button {
                            Task { await addMoreNewWordsToday() }
                        } label: {
                            Group {
                                if addingMoreWords {
                                    ProgressView().tint(.white)
                                } else {
                                    Text(additionalNewWords == 1 ? "Study 1 more new word" : "Study \(additionalNewWords) more new words")
                                }
                            }
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.purple)
                        .controlSize(.large)
                        .disabled(addingMoreWords)
                    }
                    .padding(20)
                    .background(.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 24))
                    .overlay {
                        RoundedRectangle(cornerRadius: 24)
                            .stroke(.purple.opacity(0.18), lineWidth: 1)
                    }
                } else if let completionOverview, completionOverview.newAvailable == 0 {
                    Label("No more new words are waiting in your queue.", systemImage: "checkmark.seal")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(18)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
                } else if maxAdditionalNewWords == 0 {
                    Label("You reached today's 50-new-word session limit.", systemImage: "checkmark.seal")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(18)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
                }

                Button("Done for today") { dismiss() }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 20)
            .padding(.top, 34)
            .padding(.bottom, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .texturedBackground()
        .onAppear { SoundEffects.shared.playComplete() }
        .task { await loadCompletionOptions() }
    }

    func statItem(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2.bold())
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    func loadCompletionOptions() async {
        guard !loadingCompletionOptions else { return }
        loadingCompletionOptions = true
        do {
            let latestOverview = try await APIClient.shared.studyOverview()
            completionOverview = latestOverview
            additionalNewWords = min(5, max(1, min(latestOverview.newAvailable, max(0, 50 - sessionNewWordLimit))))
        } catch {
            PolycastLog.runtime.error("[Polycast] Failed to load completion options: \(error)")
        }
        loadingCompletionOptions = false
    }

    func addMoreNewWordsToday() async {
        guard additionalNewWords > 0, let user = session.user else { return }
        addingMoreWords = true
        let savedDailyLimit = user.dailyNewLimit
        sessionNewWordLimit = min(50, sessionNewWordLimit + additionalNewWords)
        currentIndex = 0
        completionOverview = nil

        let raisedLimit = await session.updateSettings(
            nativeLanguage: user.nativeLanguage,
            targetLanguage: user.targetLanguage,
            dailyNewLimit: sessionNewWordLimit,
            accountType: user.accountType,
            cefrLevel: user.cefrLevel
        )

        if raisedLimit {
            await load()
            _ = await session.updateSettings(
                nativeLanguage: user.nativeLanguage,
                targetLanguage: user.targetLanguage,
                dailyNewLimit: savedDailyLimit,
                accountType: user.accountType,
                cefrLevel: user.cefrLevel
            )
        } else {
            error = session.authError ?? "Could not increase today's new-word count."
            cards = []
        }
        addingMoreWords = false

        if cards.isEmpty {
            await loadCompletionOptions()
        } else {
            preloadUpcomingAudio(from: currentIndex)
            autoPlayIfNeeded()
        }
    }

    // MARK: - Card Session


}
