import SwiftUI

struct PracticeHubView: View {
    @State private var drillSessions: [DrillSession] = []
    @State private var loadingDrills = true
    @State private var error = ""

    var body: some View {
        List {
            Section {
                NavigationLink("Flashcards") {
                    LearnView()
                }
            } header: {
                Text("Practice Modes")
            } footer: {
                Text("Review saved vocabulary with spaced repetition.")
            }

            Section("Coming Soon") {
                Label("Conjugation Drill", systemImage: "timer")
                    .foregroundStyle(.secondary)
                Label("Voice Translation", systemImage: "mic.fill")
                    .foregroundStyle(.secondary)
            }

            Section("Recent Drill Sessions") {
                if loadingDrills {
                    ProgressView()
                } else if drillSessions.isEmpty {
                    Text("No drill sessions yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(drillSessions) { session in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(session.tenseKey.replacingOccurrences(of: "_", with: " ").capitalized)
                                .font(.headline)
                            Text("\(session.correctCount)/\(session.questionCount) correct · \(session.durationSeconds)s")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .texturedBackground()
        .navigationTitle("Practice")
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            guard loadingDrills else { return }
            await loadDrills()
        }
        .alert("Error", isPresented: .constant(!error.isEmpty), actions: {
            Button("OK") { error = "" }
        }, message: {
            Text(error)
        })
    }

    private func loadDrills() async {
        do {
            drillSessions = try await APIClient.shared.drillSessions()
        } catch {
            self.error = error.localizedDescription
        }
        loadingDrills = false
    }
}

struct LearnView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    @State private var cards: [SavedWord] = []
    @State private var currentIndex = 0
    @State private var isFlipped = false
    @State private var isExiting = false
    @State private var exitDirection: Edge = .trailing
    @State private var isEntering = false
    @State private var loading = true
    @State private var submitting = false
    @State private var error = ""
    @State private var feedback: (answer: String, text: String)?
    @State private var sessionStats = (reviewed: 0, correct: 0, incorrect: 0)
    @State private var sessionStart = Date()
    @State private var dragOffset: CGSize = .zero
    @State private var audioPlayedForSide: Set<String> = []
    @AppStorage("flashcardAudioMuted") private var audioMuted = false
    @State private var showingCardInfo = false
    @State private var editingCard: SavedWord?
    @State private var checkingForMore = false

    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var handsFreeController = HandsFreeController.shared
    @State private var selectedLookup: LookupContext?
    @State private var started = false
    @State private var overview: StudyOverview?
    @State private var previewWords: [SavedWord] = []
    @State private var loadingOverview = true
    @State private var startingSession = false
    @State private var newWordsCount = 0
    @State private var carouselScrollID: String?
    @State private var sessionNewWordLimit = 0
    @State private var completionOverview: StudyOverview?
    @State private var loadingCompletionOptions = false
    @State private var additionalNewWords = 1
    @State private var addingMoreWords = false
    @State private var handsFree = false
    // Volume buttons are pinned in hands-free; this slider sets the pin level so
    // the learner can still change the actual loudness.
    @AppStorage("handsFreeVolume") private var handsFreeVolume: Double = 0.5

    var body: some View {
        ZStack {
            if !started {
                introView
            } else if loading {
                LoadingStateView(title: "Loading flashcards...")
            } else if cards.isEmpty {
                sessionCompleteView
            } else if currentIndex >= cards.count {
                if checkingForMore {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Checking for more cards...")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    sessionCompleteView
                }
            } else {
                cardSessionView
            }

            // Feedback overlay
            if let feedback {
                feedbackOverlay(feedback)
            }
        }
        .overlay {
            if let context = selectedLookup {
                WordPopupView(context: context, onDismiss: { selectedLookup = nil })
            }
        }
        .navigationTitle(started ? "Flashcards" : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Hands-free toggle is available on the start screen and during a
            // session so the learner can flip it on before or mid-practice.
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    handsFree.toggle()
                } label: {
                    Image(systemName: handsFree ? "headphones.circle.fill" : "headphones")
                        .foregroundStyle(handsFree ? .purple : .secondary)
                }
                .accessibilityLabel("Hands-free mode")
            }
            if started && !loading && currentIndex < cards.count {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editingCard = cards[currentIndex]
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingCardInfo = true
                    } label: {
                        Image(systemName: "info.circle")
                    }
                }
            }
        }
        .sheet(item: $editingCard) { card in
            WordEditView(word: card) { updated in
                if let idx = cards.firstIndex(where: { $0.id == updated.id }) {
                    cards[idx] = updated
                }
            }
        }
        .sheet(isPresented: $showingCardInfo) {
            if currentIndex < cards.count {
                CardInfoSheet(
                    card: cards[currentIndex],
                    onDelete: {
                        let id = cards[currentIndex].id
                        cards.remove(at: currentIndex)
                        showingCardInfo = false
                        Task {
                            do {
                                try await APIClient.shared.deleteWord(id: id)
                            } catch {
                                print("[Polycast] Failed to delete word: \(error)")
                            }
                        }
                    }
                )
            }
        }
        .task {
            guard overview == nil else { return }
            await loadOverview()
        }
        .onAppear {
            // Re-fetch every time the Practice tab is shown so words added
            // elsewhere appear without relaunching. First load is handled by
            // `.task` (overview == nil); this only refreshes on re-appearance,
            // and never while a session is active.
            guard !started, overview != nil, !loadingOverview else { return }
            Task { await loadOverview() }
        }
        .onChange(of: scenePhase) {
            // Re-fetch when the app returns to the foreground so a session
            // finished on another device is reflected here (cross-device sync).
            // Only refresh the start screen — never disrupt an in-progress session.
            guard scenePhase == .active, !started else { return }
            Task { await loadOverview() }
        }
        .onChange(of: handsFree) { configureHandsFree() }
        .onChange(of: started) { configureHandsFree() }
        .onChange(of: handsFreeVolume) {
            HandsFreeController.shared.setBaseline(Float(handsFreeVolume))
        }
        .onChange(of: handsFreeController.eventTick) {
            handleHandsFreeEvent(handsFreeController.lastEvent)
        }
        .onChange(of: currentIndex) {
            AudioPlayer.shared.stop()
            // Read the new card's prompt aloud (native language) in hands-free.
            if handsFree, started, currentIndex < cards.count { handsFreeAnnounceCurrent() }
        }
        .onDisappear {
            AudioPlayer.shared.clearCache()
            HandsFreeController.shared.deactivate()
        }
        .alert("Error", isPresented: .constant(!error.isEmpty), actions: {
            Button("OK") { error = "" }
        }, message: {
            Text(error)
        })
    }

    // MARK: - Start screen

    private var maxNewWords: Int { min(overview?.newAvailable ?? 0, 50) }
    private var selectedPreviewWords: [SavedWord] { Array(previewWords.prefix(newWordsCount)) }

    private var introView: some View {
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

    private func practiceTotalCard(_ overview: StudyOverview) -> some View {
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


    private var newWordsCarousel: some View {
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

    private func carouselArrow(_ systemName: String, step: Int) -> some View {
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

    private func newWordPreviewCard(_ word: SavedWord) -> some View {
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
    private func previewImage(for word: SavedWord) -> some View {
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

    private var previewImagePlaceholder: some View {
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

    private func wordCountControl(value: Binding<Int>, range: ClosedRange<Int>) -> some View {
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

    private func loadOverview() async {
        loadingOverview = true
        do {
            async let overviewRequest = APIClient.shared.studyOverview()
            async let wordsRequest = APIClient.shared.newWordPreview(limit: 50)
            let (ov, words) = try await (overviewRequest, wordsRequest)
            overview = ov
            previewWords = upcomingNewWords(from: words)
            wordStore.upsert(contentsOf: words)
            newWordsCount = min(ov.dailyNewLimit, min(ov.newAvailable, 50))
            // Warm the carousel images so swiping to upcoming slides never flashes.
            prefetchWordImages(previewWords.prefix(newWordsCount).compactMap { APIClient.proxyImageURL($0.imageUrl) })
        } catch {
            self.error = error.localizedDescription
        }
        loadingOverview = false
    }

    private func startSession() async {
        startingSession = true
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
        await load()
        started = true
        startingSession = false
        if !cards.isEmpty {
            preloadUpcomingAudio(from: currentIndex)
            prefetchUpcomingImages(from: 0)
            autoPlayIfNeeded()
        }
    }

    // MARK: - Gradients

    private func cardGradient(promptType: PromptType, isBack: Bool) -> LinearGradient {
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

    private func cardBorderColor(promptType: PromptType, isBack: Bool) -> Color {
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

    private var maxAdditionalNewWords: Int {
        min(completionOverview?.newAvailable ?? 0, max(0, 50 - sessionNewWordLimit))
    }

    private var sessionCompleteView: some View {
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

    private func statItem(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2.bold())
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func loadCompletionOptions() async {
        guard !loadingCompletionOptions else { return }
        loadingCompletionOptions = true
        do {
            let latestOverview = try await APIClient.shared.studyOverview()
            completionOverview = latestOverview
            additionalNewWords = min(5, max(1, min(latestOverview.newAvailable, max(0, 50 - sessionNewWordLimit))))
        } catch {
            print("[Polycast] Failed to load completion options: \(error)")
        }
        loadingCompletionOptions = false
    }

    private func addMoreNewWordsToday() async {
        guard additionalNewWords > 0, let user = session.user else { return }
        addingMoreWords = true
        let savedDailyLimit = user.dailyNewLimit ?? overview?.dailyNewLimit ?? 0
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

    private var cardSessionView: some View {
        let card = cards[currentIndex]
        let promptType = getPromptType(card: card)

        return VStack(spacing: 16) {
            progressCounter

            if handsFree {
                handsFreeVolumeBar
            }

            Text(getInstructionText(promptType))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)

            cardView(card: card, promptType: promptType)
                .offset(x: cardOffsetX, y: isEntering ? 56 : 0)
                .rotationEffect(.degrees(cardRotationDegrees))
                .opacity(isExiting || isEntering ? 0 : 1)
                .scaleEffect(isEntering ? 0.95 : 1)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isEntering)
                .gesture(dragGesture(card: card))

            answerButtons(card: card)
        }
        .padding()
    }

    // MARK: - Progress Counter

    /// Distinct cards remaining in the new, learning, and review queues.
    /// Volume slider shown in hands-free: sets the pin level the volume buttons
    /// snap back to (so loudness is controllable even though the buttons act as
    /// Correct/Repeat triggers).
    private var handsFreeVolumeBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "speaker.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
            Slider(value: $handsFreeVolume, in: 0...1)
                .tint(.purple)
            Image(systemName: "speaker.wave.3.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 4)
    }

    private var progressCounter: some View {
        let counts = studyQueueCounts(cards: cards.suffix(from: currentIndex))
        let current = currentIndex < cards.count ? studyQueueBucket(card: cards[currentIndex]) : nil

        return HStack(spacing: 4) {
            Text("\(counts.new)")
                .foregroundStyle(.blue).fontWeight(.bold)
                .underline(current == .new)
            Text("+").foregroundStyle(.secondary)
            Text("\(counts.learning)")
                .foregroundStyle(.red).fontWeight(.bold)
                .underline(current == .learning)
            Text("+").foregroundStyle(.secondary)
            Text("\(counts.review)")
                .foregroundStyle(.green).fontWeight(.bold)
                .underline(current == .review)
        }
        .font(.footnote.monospacedDigit())
    }

    // MARK: - Card View

    private var cardOffsetX: CGFloat {
        if isExiting {
            let distance = UIScreen.main.bounds.width + 260
            return exitDirection == .trailing ? distance : -distance
        }
        return dragOffset.width
    }

    private var cardRotationDegrees: Double {
        if isExiting {
            return exitDirection == .trailing ? 26 : -26
        }
        return Double(dragOffset.width) * 0.03
    }

    private func cardView(card: SavedWord, promptType: PromptType) -> some View {
        return ZStack {
            cardFace(card: card, promptType: promptType, isBack: false)
                .opacity(isFlipped ? 0 : 1)
                .allowsHitTesting(!isFlipped)
                .rotation3DEffect(.degrees(isFlipped ? 180 : 0), axis: (x: 0, y: 1, z: 0), perspective: 0.72)

            cardFace(card: card, promptType: promptType, isBack: true)
                .opacity(isFlipped ? 1 : 0)
                .allowsHitTesting(isFlipped)
                .rotation3DEffect(.degrees(isFlipped ? 0 : -180), axis: (x: 0, y: 1, z: 0), perspective: 0.72)
        }
        .animation(.spring(response: 0.58, dampingFraction: 0.78), value: isFlipped)
        .compositingGroup()
        .onTapGesture {
            guard !submitting, !isExiting, !isFlipped else { return }
            AudioPlayer.shared.stop()
            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                isFlipped = true
            }
            playOnFlip()
        }
    }

    private func cardFace(card: SavedWord, promptType: PromptType, isBack: Bool) -> some View {
        let gradient = cardGradient(promptType: promptType, isBack: isBack)
        let borderColor = cardBorderColor(promptType: promptType, isBack: isBack)
        let swipeProgress = min(abs(dragOffset.width) / 150.0, 1.0)
        let activeBorder = dragOffset.width < 0
            ? Color.red.opacity(Double(swipeProgress) * 0.8)
            : dragOffset.width > 0
                ? Color.green.opacity(Double(swipeProgress) * 0.75)
                : borderColor.opacity(0.5)

        return ZStack {
            RoundedRectangle(cornerRadius: 24)
                .fill(gradient)
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(activeBorder, lineWidth: 1.5)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .fill(
                            LinearGradient(
                                colors: [.white.opacity(0.42), .white.opacity(0.06), .clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .allowsHitTesting(false)
                )
                .shadow(color: .black.opacity(0.16), radius: 18, y: 8)

            VStack(spacing: 0) {
                if isBack {
                    cardBack(card: card, promptType: promptType)
                } else {
                    cardFront(card: card, promptType: promptType)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(24)

            cardBadges(card: card, isBack: isBack)
            cardAudioControls(card: card, promptType: promptType, isBack: isBack)
        }
        .frame(maxWidth: 560)
        .frame(height: min(UIScreen.main.bounds.height * 0.48, 390))
        .contentShape(RoundedRectangle(cornerRadius: 24))
    }

    private func cardBadges(card: SavedWord, isBack: Bool) -> some View {
        VStack {
            HStack(spacing: 6) {
                Text("Stage \(displayStage(card))")
                    .font(.caption.bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(.purple, in: Capsule())
                    .shadow(color: .purple.opacity(0.3), radius: 4)
                if !isBack && isNewCard(card) {
                    Text("New")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(.blue, in: Capsule())
                        .shadow(color: .blue.opacity(0.3), radius: 4)
                }
                Spacer()
            }
            Spacer()
        }
        .padding(16)
    }

    private func cardAudioControls(card: SavedWord, promptType: PromptType, isBack: Bool) -> some View {
        VStack {
            HStack(spacing: 8) {
                Spacer()
                Button {
                    audioMuted.toggle()
                    if audioMuted {
                        AudioPlayer.shared.stop()
                    }
                } label: {
                    Image(systemName: audioMuted ? "speaker.slash.fill" : "speaker.slash")
                        .font(.body)
                        .foregroundStyle(audioMuted ? Color.red.opacity(0.7) : .primary.opacity(0.5))
                        .padding(10)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .buttonStyle(.plain)

                if spokenText(card: card, promptType: promptType, back: isBack) != nil {
                    Button {
                        AudioPlayer.shared.stop()
                        speakCurrentSide(card: card, promptType: promptType)
                    } label: {
                        Image(systemName: "speaker.wave.2.fill")
                            .font(.body)
                            .foregroundStyle(.primary.opacity(0.5))
                            .padding(10)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer()
        }
        .padding(12)
    }

    // MARK: - Card Front

    private func cardFront(card: SavedWord, promptType: PromptType) -> some View {
        VStack(spacing: 16) {
            switch promptType {
            case .meetWord:
                // Target sentence with the word highlighted, plus the picture.
                // Words without an example fall back to the bare word.
                if let example = card.exampleSentence, !example.isEmpty {
                    TappableSentenceText(text: example, font: .title3, selectedLookup: $selectedLookup)
                } else {
                    Text(card.word)
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .multilineTextAlignment(.center)
                }
                cardImage(card: card)

            case .sentenceMeaning:
                // Same sentence, no picture — translating it IS the test.
                if let example = card.exampleSentence, !example.isEmpty {
                    TappableSentenceText(text: example, font: .title3, selectedLookup: $selectedLookup)
                }

            case .wordProduction:
                Text(card.translation)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                if !card.definition.isEmpty {
                    Text(card.definition)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                cardImage(card: card)

            case .sentenceProduction:
                // Native sentence with the word's translation highlighted; the
                // picture pins down which idea is meant. Stages 4+ use the
                // per-stage pair from `currentExample`; stage 3 falls through
                // to the base columns via the same helper.
                let pair = currentExample(for: card)
                if let translation = pair?.translation, !translation.isEmpty {
                    Text(renderTildeHighlight(translation))
                        .font(.title3)
                        .multilineTextAlignment(.center)
                }
                cardImage(card: card)
            }

            HStack(spacing: 6) {
                Image(systemName: "hand.tap")
                    .font(.caption.weight(.medium))
                Text("Tap to reveal")
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(.black.opacity(0.06), in: Capsule())
        }
    }

    // MARK: - Card Back

    private func cardBack(card: SavedWord, promptType: PromptType) -> some View {
        VStack(spacing: 14) {
            switch promptType {
            case .meetWord:
                Text(card.translation)
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .multilineTextAlignment(.center)
                cardImage(card: card)
                if !card.definition.isEmpty {
                    Text(card.definition)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                if let sentenceTranslation = card.sentenceTranslation, !sentenceTranslation.isEmpty {
                    Text(stripTildes(sentenceTranslation))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

            case .sentenceMeaning:
                if let sentenceTranslation = card.sentenceTranslation, !sentenceTranslation.isEmpty {
                    Text(renderTildeHighlight(sentenceTranslation))
                        .font(.title3)
                        .multilineTextAlignment(.center)
                }
                cardImage(card: card)
                HStack(spacing: 4) {
                    Text(card.word).fontWeight(.bold)
                    Text("--")
                    Text(card.translation)
                }
                .font(.callout)
                .foregroundStyle(.secondary)

            case .wordProduction:
                Text(card.word)
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .foregroundStyle(.green)
                    .multilineTextAlignment(.center)
                cardImage(card: card)
                if !card.definition.isEmpty {
                    Text(card.definition)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                if let example = card.exampleSentence, !example.isEmpty {
                    TappableSentenceText(text: example, font: .callout, selectedLookup: $selectedLookup)
                }

            case .sentenceProduction:
                // Stages 3+ use the per-stage example sentence so each rung of
                // the ladder shows a fresh context. `currentExample` returns
                // the right pair for the current stage (base columns for 3,
                // per-stage entry from `stageSentences` for 4+).
                if let example = currentExample(for: card)?.example, !example.isEmpty {
                    TappableSentenceText(text: example, font: .title3, selectedLookup: $selectedLookup)
                }
                cardImage(card: card)
                HStack(spacing: 4) {
                    Text(card.word).fontWeight(.bold)
                    Text("--")
                    Text(card.translation)
                }
                .font(.callout)
                .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Card Image

    @ViewBuilder
    private func cardImage(card: SavedWord) -> some View {
        if let url = APIClient.proxyImageURL(card.imageUrl) {
            AuthorizedAsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 160)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                default:
                    EmptyView()
                }
            }
        }
    }

    // MARK: - Answer Buttons

    /// Current difficulty stage for display. The ladder can climb past stage 3
    /// (each rung shows a fresh per-stage example sentence), so we just return
    /// the real value.
    private func displayStage(_ card: SavedWord) -> Int {
        card.promptStage ?? 0
    }

    /// The stage this answer moves the card to.
    private func nextStageLabel(card: SavedWord, answer: String) -> String {
        "Stage \(nextPromptStage(card: card, answer: answer))"
    }

    private func answerButtons(card: SavedWord) -> some View {
        HStack(spacing: 16) {
            Button {
                Task { await handleAnswer(card: card, answer: "again") }
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "xmark")
                        .font(.title3.weight(.bold))
                    Text("Incorrect")
                        .font(.caption.weight(.medium))
                    Text(getButtonTimeLabel(card: card, answer: "again"))
                        .font(.caption2)
                    Text(nextStageLabel(card: card, answer: "again"))
                        .font(.caption2.weight(.semibold))
                        .opacity(0.85)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .foregroundStyle(.white)
                .background(Color.red.opacity(isFlipped && !submitting ? 1 : 0.35), in: RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.plain)
            .disabled(!isFlipped || submitting)

            Button {
                Task { await handleAnswer(card: card, answer: "good") }
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "checkmark")
                        .font(.title3.weight(.bold))
                    Text("Correct")
                        .font(.caption.weight(.medium))
                    Text(getButtonTimeLabel(card: card, answer: "good"))
                        .font(.caption2)
                    Text(nextStageLabel(card: card, answer: "good"))
                        .font(.caption2.weight(.semibold))
                        .opacity(0.85)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .foregroundStyle(.white)
                .background(Color.green.opacity(isFlipped && !submitting ? 1 : 0.35), in: RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.plain)
            .disabled(!isFlipped || submitting)
        }
    }

    // MARK: - Feedback Overlay

    private func feedbackOverlay(_ fb: (answer: String, text: String)) -> some View {
        VStack {
            Text(fb.text)
                .font(.title3.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(
                    fb.answer == "again" ? Color.red : Color.green,
                    in: Capsule()
                )
        }
        .transition(.scale.combined(with: .opacity))
        .allowsHitTesting(false)
    }

    // MARK: - Drag Gesture

    private func dragGesture(card: SavedWord) -> some Gesture {
        DragGesture()
            .onChanged { value in
                guard isFlipped, !submitting, !isExiting else { return }
                dragOffset = value.translation
            }
            .onEnded { value in
                guard isFlipped, !submitting, !isExiting else {
                    dragOffset = .zero
                    return
                }
                let threshold: CGFloat = 60

                if abs(value.translation.width) > threshold {
                    let answer = value.translation.width > 0 ? "good" : "again"
                    Task { await handleAnswer(card: card, answer: answer) }
                } else {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        dragOffset = .zero
                    }
                }
            }
    }

    // MARK: - Audio

    /// Target-language text shown on the given card side, or nil when the
    /// side displays only native-language content (which is never read aloud).
    private func spokenText(card: SavedWord, promptType: PromptType, back: Bool) -> String? {
        // Resolve the example sentence for the current stage. Stages 0-2 use
        // the base column; stage 3+ uses `currentExample` so the spoken text
        // matches the per-stage pair shown on the card.
        let stage = card.promptStage ?? 0
        let exampleRaw: String?
        if stage <= 2 {
            exampleRaw = card.exampleSentence
        } else {
            exampleRaw = currentExample(for: card)?.example
        }
        let example: String? = {
            guard let raw = exampleRaw, !raw.isEmpty else { return nil }
            return stripTildes(raw)
        }()

        if !back {
            switch promptType {
            case .meetWord:
                // Front shows the sentence (or bare word when no example).
                return example ?? card.word
            case .sentenceMeaning:
                return example
            case .wordProduction, .sentenceProduction:
                // Production fronts show only native-language content.
                return nil
            }
        }

        switch promptType {
        case .meetWord:
            // Back is the answer in the native language; the sentence was
            // already read on the front.
            return nil
        case .sentenceMeaning:
            // Back is native-language content; never read it aloud.
            return nil
        case .wordProduction:
            guard let example else { return card.word }
            return "\(card.word). \(example)"
        case .sentenceProduction:
            return example ?? card.word
        }
    }

    private func speakCurrentSide(card: SavedWord, promptType: PromptType) {
        guard let text = spokenText(card: card, promptType: promptType, back: isFlipped) else { return }
        if text == card.word {
            // Word-only: use the per-word clip cached server-side.
            AudioPlayer.shared.play(wordId: card.id)
        } else {
            AudioPlayer.shared.speakText(text, languageCode: card.targetLanguage)
        }
    }

    /// Double-tap handler: replay the audio for the side currently showing.
    private func replayCurrentSideAudio(card: SavedWord, promptType: PromptType) {
        if handsFree {
            if isFlipped { handsFreeReadAnswer(card: card) } else { handsFreeAnnounceCurrent() }
        } else {
            speakCurrentSide(card: card, promptType: promptType)
        }
    }

    /// Pre-fetch audio for the current card and the next few cards, including
    /// hands-free prompt/answer fragments. Answer fragments are queued first so
    /// the reverse side is ready by the time the learner reveals the card.
    private func preloadUpcomingAudio(from start: Int) {
        guard start < cards.count else { return }
        let end = min(start + 6, cards.count)
        preloadAudio(for: Array(cards[start..<end]))
    }

    /// Pre-fetch both the per-word clips and every TTS fragment a card may
    /// speak, so card fronts, reveals, and hands-free repeats do not wait on
    /// synthesis.
    private func preloadAudio(for cards: [SavedWord]) {
        AudioPlayer.shared.preload(cards: cards)
        var items: [(text: String, languageCode: String?)] = []
        var seen = Set<String>()

        func enqueue(_ text: String, languageCode: String?) {
            let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalized.isEmpty else { return }
            let key = "\(normalized)\u{001f}\(languageCode ?? "")"
            if seen.insert(key).inserted {
                items.append((normalized, languageCode))
            }
        }

        for card in cards {
            for part in handsFreeAnswerParts(card: card) {
                enqueue(part.text, languageCode: part.languageCode)
            }
            for part in handsFreePromptParts(card: card) {
                enqueue(part.text, languageCode: part.languageCode)
            }

            let pt = getPromptType(card: card)
            for back in [false, true] {
                // Word-only speech plays the per-word clip preloaded above.
                guard let text = spokenText(card: card, promptType: pt, back: back), text != card.word else { continue }
                enqueue(text, languageCode: card.targetLanguage)
            }
        }
        AudioPlayer.shared.preloadSpeech(items)
    }

    /// Warm the images for the next few cards so they're already cached when the
    /// learner swipes to them (no per-card load flash).
    private func prefetchUpcomingImages(from start: Int) {
        guard start < cards.count else { return }
        let end = min(start + 5, cards.count)
        prefetchWordImages(cards[start..<end].compactMap { APIClient.proxyImageURL($0.imageUrl) })
    }

    // MARK: - Hands-free mode

    /// Wire (or tear down) the remote-control callbacks based on the toggle and
    /// whether a session is active. Inert whenever hands-free is off.
    ///
    /// Controls: single press (play/pause) flips the card, then a second single
    /// press marks Correct; a double press marks Incorrect. Volume up reveals
    /// the card from the front, then marks Correct once revealed. Volume down
    /// repeats the prompt from the front, then marks Incorrect once revealed.
    /// The volume buttons are pinned (see HandsFreeController) so they don't
    /// change loudness — the on-screen slider sets the level.
    private func configureHandsFree() {
        let controller = HandsFreeController.shared
        guard handsFree, started else {
            controller.deactivate()
            return
        }
        controller.activate()
        controller.setBaseline(Float(handsFreeVolume))
        handsFreeAnnounceCurrent()
    }

    /// Handle a remote-control event with the view's CURRENT state (the view
    /// observes `eventTick` and calls this), avoiding the stale-state bug of
    /// closures captured once.
    private func handleHandsFreeEvent(_ event: HandsFreeController.Event) {
        guard handsFree, started, currentIndex < cards.count, !submitting else { return }
        let card = cards[currentIndex]
        switch event {
        case .playPause:
            if !isFlipped {
                handsFreeReveal(card: card)
            } else {
                Task { await handleAnswer(card: card, answer: "good") }
            }
        case .incorrect:
            if isFlipped { Task { await handleAnswer(card: card, answer: "again") } }
        case .volumeUp:
            if !isFlipped {
                handsFreeReveal(card: card)
            } else {
                Task { await handleAnswer(card: card, answer: "good") }
            }
        case .volumeDown:
            if isFlipped {
                // Answer is revealed → mark Incorrect.
                Task { await handleAnswer(card: card, answer: "again") }
            } else {
                // Front → repeat the prompt audio.
                replayCurrentSideAudio(card: card, promptType: getPromptType(card: card))
            }
        }
    }

    private func handsFreeReveal(card: SavedWord) {
        AudioPlayer.shared.stop()
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { isFlipped = true }
        handsFreeReadAnswer(card: card)
    }

    /// Speak the current card's prompt, using the NATIVE voice for instruction
    /// text and the TARGET voice for any target-language word/sentence.
    private func handsFreeAnnounceCurrent() {
        guard handsFree, currentIndex < cards.count else { return }
        let card = cards[currentIndex]
        let parts = handsFreePromptParts(card: card)
        let title = parts.map(\.text).joined(separator: " ")
        HandsFreeController.shared.setNowPlaying(title, subtitle: "Press play to reveal")
        AudioPlayer.shared.speakSequence(parts)
    }

    /// Read the answer side aloud after a reveal, each part in its own voice.
    private func handsFreeReadAnswer(card: SavedWord) {
        AudioPlayer.shared.speakSequence(handsFreeAnswerParts(card: card))
    }

    private var nativeLang: String? { session.user?.nativeLanguage }
    private var targetLang: String? { session.user?.targetLanguage }

    /// The prompt, split so each part is spoken in the right language/voice.
    private func handsFreePromptParts(card: SavedWord) -> [(text: String, languageCode: String?)] {
        switch getPromptType(card: card) {
        case .meetWord:
            if let ex = card.exampleSentence, !ex.isEmpty {
                return [("Translate", nativeLang), (card.word, targetLang),
                        ("in the sentence", nativeLang), (stripTildes(ex), targetLang)]
            }
            return [("Translate the word", nativeLang), (card.word, targetLang)]
        case .sentenceMeaning:
            if let ex = card.exampleSentence, !ex.isEmpty {
                return [("What does this sentence mean?", nativeLang), (stripTildes(ex), targetLang)]
            }
            return [("Translate the word", nativeLang), (card.word, targetLang)]
        case .wordProduction:
            // Front is all native (translation + definition).
            return [("How do you say \(card.translation)?", nativeLang)]
        case .sentenceProduction:
            if let pair = currentExample(for: card)?.translation, !pair.isEmpty {
                return [("How do you say this sentence?", nativeLang), (stripTildes(pair), nativeLang)]
            }
            return [("How do you say \(card.translation)?", nativeLang)]
        }
    }

    /// The answer side, split so each part is spoken in the right voice.
    private func handsFreeAnswerParts(card: SavedWord) -> [(text: String, languageCode: String?)] {
        switch getPromptType(card: card) {
        case .meetWord:
            var parts: [(String, String?)] = [(card.translation, nativeLang)]
            if let st = card.sentenceTranslation, !st.isEmpty { parts.append((stripTildes(st), nativeLang)) }
            return parts
        case .sentenceMeaning:
            if let st = card.sentenceTranslation, !st.isEmpty { return [(stripTildes(st), nativeLang)] }
            return [(card.translation, nativeLang)]
        case .wordProduction:
            var parts: [(String, String?)] = [(card.word, targetLang)]
            if let ex = card.exampleSentence, !ex.isEmpty { parts.append((stripTildes(ex), targetLang)) }
            return parts
        case .sentenceProduction:
            if let ex = currentExample(for: card)?.example, !ex.isEmpty { return [(stripTildes(ex), targetLang)] }
            return [(card.word, targetLang)]
        }
    }

    private func autoPlayIfNeeded() {
        // In hands-free mode the native prompt is read instead of the normal
        // target-side autoplay; `handsFreeAnnounceCurrent()` handles speech.
        if handsFree { return }
        guard !audioMuted, currentIndex < cards.count else { return }
        let card = cards[currentIndex]
        let pt = getPromptType(card: card)
        let key = "\(currentIndex)-front"
        guard !audioPlayedForSide.contains(key) else { return }
        guard spokenText(card: card, promptType: pt, back: false) != nil else { return }
        audioPlayedForSide.insert(key)
        speakCurrentSide(card: card, promptType: pt)
    }

    private func playOnFlip() {
        guard !audioMuted, currentIndex < cards.count else { return }
        let card = cards[currentIndex]
        let key = "\(currentIndex)-back"
        guard !audioPlayedForSide.contains(key) else { return }
        audioPlayedForSide.insert(key)
        speakCurrentSide(card: card, promptType: getPromptType(card: card))
    }

    // MARK: - Actions

    private func load() async {
        loading = true
        do {
            cards = interleavedStudyQueue(try await APIClient.shared.dueWords())
            wordStore.upsert(contentsOf: cards)
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func handleAnswer(card: SavedWord, answer: String) async {
        guard !submitting, isFlipped else { return }
        AudioPlayer.shared.stop()
        submitting = true

        let timeLabel = getButtonTimeLabel(card: card, answer: answer)
        let stageChange = "Stage \(displayStage(card)) → \(nextPromptStage(card: card, answer: answer))"
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            feedback = (answer: answer, text: "\(timeLabel) · \(stageChange)")
        }

        sessionStats.reviewed += 1
        if answer == "again" {
            sessionStats.incorrect += 1
            SoundEffects.shared.playIncorrect()
        } else {
            sessionStats.correct += 1
            SoundEffects.shared.playCorrect()
        }

        let nextDue = getNextDueSeconds(card: card, answer: answer)
        let shouldRequeue = nextDue <= 20 * 60
        let localUpdate = applyAnswerLocally(card: card, answer: answer)

        exitDirection = answer == "again" ? .leading : .trailing
        withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) {
            isExiting = true
        }

        Task { await submitReview(card: card, answer: answer) }

        try? await Task.sleep(nanoseconds: 420_000_000)

        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            feedback = nil
            isExiting = false
            isFlipped = false
            dragOffset = .zero

            if shouldRequeue {
                // The local update carries today's direct blue/red/green status
                // even if the deployed API has not returned those date fields.
                cards.append(localUpdate)
            }

            currentIndex += 1

            if currentIndex >= cards.count {
                checkingForMore = true
            }

            isEntering = true
        }

        // Keep the next few cards' images warm so they appear without a flash.
        prefetchUpcomingImages(from: currentIndex)

        submitting = false

        if checkingForMore {
            do {
                let more = interleavedStudyQueue(try await APIClient.shared.dueWords())
                let knownIDs = Set(cards.map(\.id))
                let unseen = more.filter { !knownIDs.contains($0.id) }
                if !unseen.isEmpty {
                    cards.append(contentsOf: unseen)
                }
            } catch {
                print("[Polycast] Failed to check for more cards: \(error)")
            }
            checkingForMore = false
        }

        preloadUpcomingAudio(from: currentIndex)
        autoPlayIfNeeded()

        try? await Task.sleep(nanoseconds: 350_000_000)
        withAnimation {
            isEntering = false
        }
    }

    private func submitReview(card: SavedWord, answer: String) async {
        do {
            _ = try await APIClient.shared.reviewWord(id: card.id, answer: answer)
        } catch {
            print("[Polycast] Review error: \(error.localizedDescription)")
        }
    }
}

private func upcomingNewWords(from words: [SavedWord]) -> [SavedWord] {
    return words
        .filter { word in
            word.srsInterval == 0 && word.learningStep == nil && word.lastReviewedAt == nil
        }
        .sorted { lhs, rhs in
            let lhsQueue = lhs.queuePosition ?? .max
            let rhsQueue = rhs.queuePosition ?? .max
            if lhsQueue != rhsQueue { return lhsQueue < rhsQueue }

            if lhs.priority != rhs.priority { return lhs.priority && !rhs.priority }

            let lhsCount = lhs.frequencyCount ?? 0
            let rhsCount = rhs.frequencyCount ?? 0
            if lhsCount != rhsCount { return lhsCount > rhsCount }

            let lhsFrequency = lhs.frequency ?? 0
            let rhsFrequency = rhs.frequency ?? 0
            if lhsFrequency != rhsFrequency { return lhsFrequency > rhsFrequency }

            if lhs.createdAt != rhs.createdAt { return lhs.createdAt < rhs.createdAt }
            return lhs.id < rhs.id
        }
}

struct CardInfoSheet: View {
    let card: SavedWord
    let onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Word") {
                    LabeledContent("Word", value: card.word)
                    LabeledContent("Translation", value: card.translation)
                    if !card.definition.isEmpty {
                        LabeledContent("Definition", value: card.definition)
                    }
                    if let pos = card.partOfSpeech, !pos.isEmpty {
                        LabeledContent("Part of Speech", value: pos)
                    }
                }

                if let example = card.exampleSentence, !example.isEmpty {
                    Section("Example") {
                        Text(renderTildeHighlight(example))
                        if let sentenceTranslation = card.sentenceTranslation, !sentenceTranslation.isEmpty {
                            Text(sentenceTranslation)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let url = APIClient.proxyImageURL(card.imageUrl) {
                    Section("Image") {
                        AuthorizedAsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .scaledToFit()
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                            default:
                                ProgressView()
                            }
                        }
                    }
                }

                Section("Review Stats") {
                    let status = getDueStatus(card)
                    LabeledContent("Status", value: status.label)
                    if card.srsInterval > 0 {
                        LabeledContent("Interval", value: formatDuration(card.srsInterval))
                    }
                    LabeledContent("Correct", value: "\(card.correctCount)")
                    LabeledContent("Incorrect", value: "\(card.incorrectCount)")
                    LabeledContent("Ease", value: "\(Int(card.easeFactor * 100))%")
                }

                Section {
                    Button("Delete Word", role: .destructive) {
                        onDelete()
                    }
                }
            }
            .navigationTitle("Card Info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
