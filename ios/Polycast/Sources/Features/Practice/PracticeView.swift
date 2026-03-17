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
                NavigationLink("Mixed Quiz") {
                    QuizView()
                }
            } header: {
                Text("Practice Modes")
            } footer: {
                Text("This preliminary app includes the core review and quiz flows first.")
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
    @State private var audioPlayedForIndex: Set<Int> = []
    @State private var showingCardInfo = false

    var body: some View {
        ZStack {
            if loading {
                LoadingStateView(title: "Loading flashcards...")
            } else if cards.isEmpty {
                EmptyStateView(title: "No words to study", subtitle: "Save words from conversations to start learning.")
            } else if currentIndex >= cards.count {
                sessionCompleteView
            } else {
                cardSessionView
            }

            // Feedback overlay
            if let feedback {
                feedbackOverlay(feedback)
            }
        }
        .navigationTitle("Flashcards")
        .toolbar {
            if !loading && currentIndex < cards.count {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingCardInfo = true
                    } label: {
                        Image(systemName: "info.circle")
                    }
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
            guard cards.isEmpty else { return }
            await load()
            if !cards.isEmpty {
                AudioPlayer.shared.preload(cards: cards)
                autoPlayIfNeeded()
            }
        }
        .onDisappear {
            AudioPlayer.shared.clearCache()
        }
        .alert("Error", isPresented: .constant(!error.isEmpty), actions: {
            Button("OK") { error = "" }
        }, message: {
            Text(error)
        })
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
        case .recognition, .recall:
            return isDark
                ? LinearGradient(colors: [Color(red: 0.12, green: 0.14, blue: 0.25), Color(red: 0.1, green: 0.12, blue: 0.22)], startPoint: .topLeading, endPoint: .bottomTrailing)
                : LinearGradient(colors: [Color(red: 0.88, green: 0.92, blue: 1.0), Color(red: 0.78, green: 0.85, blue: 0.99)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .guidedCloze, .contextComprehension, .targetCloze:
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
        case .recognition, .recall:
            return isDark ? Color(red: 0.2, green: 0.25, blue: 0.4) : Color(red: 0.7, green: 0.78, blue: 0.95)
        case .guidedCloze, .contextComprehension, .targetCloze:
            return isDark ? Color(red: 0.28, green: 0.2, blue: 0.38) : Color(red: 0.82, green: 0.78, blue: 0.95)
        }
    }

    // MARK: - Session Complete

    private var sessionCompleteView: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.green)

            Text("Session Complete")
                .font(.title.bold())

            let duration = Int(Date().timeIntervalSince(sessionStart))
            let mins = duration / 60
            let secs = duration % 60
            let accuracy = sessionStats.reviewed > 0
                ? Int(round(Double(sessionStats.correct) / Double(sessionStats.reviewed) * 100))
                : 0

            HStack(spacing: 32) {
                statItem(value: "\(sessionStats.reviewed)", label: "Cards reviewed")
                statItem(value: "\(accuracy)%", label: "Accuracy")
                statItem(value: mins > 0 ? "\(mins)m \(secs)s" : "\(secs)s", label: "Duration")
            }

            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

            Spacer()
        }
        .padding()
    }

    private func statItem(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2.bold())
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Card Session

    private var cardSessionView: some View {
        let card = cards[currentIndex]
        let promptType = getPromptType(card: card)

        return VStack(spacing: 16) {
            progressCounter

            Text(getInstructionText(promptType))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)

            cardView(card: card, promptType: promptType)
                .offset(x: dragOffset.width)
                .rotationEffect(.degrees(Double(dragOffset.width) * 0.03))
                .opacity(isExiting ? 0 : 1)
                .scaleEffect(isEntering ? 0.95 : 1)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isEntering)
                .gesture(dragGesture(card: card))

            answerButtons(card: card)
        }
        .padding()
    }

    // MARK: - Progress Counter

    private var progressCounter: some View {
        let remaining = cards.suffix(from: currentIndex)
        var newCount = 0
        var learningCount = 0
        var reviewCount = 0
        for c in remaining {
            if isNewCard(c) { newCount += 1 }
            else if c.learningStep != nil { learningCount += 1 }
            else { reviewCount += 1 }
        }

        return HStack(spacing: 4) {
            Text("\(newCount)").foregroundStyle(.blue).fontWeight(.bold)
            Text("+").foregroundStyle(.secondary)
            Text("\(learningCount)").foregroundStyle(.red).fontWeight(.bold)
            Text("+").foregroundStyle(.secondary)
            Text("\(reviewCount)").foregroundStyle(.green).fontWeight(.bold)
        }
        .font(.footnote.monospacedDigit())
    }

    // MARK: - Card View

    private func cardView(card: SavedWord, promptType: PromptType) -> some View {
        let isBackSide = isFlipped
        let gradient = cardGradient(promptType: promptType, isBack: isBackSide)
        let borderColor = cardBorderColor(promptType: promptType, isBack: isBackSide)

        return ZStack {
            RoundedRectangle(cornerRadius: 24)
                .fill(gradient)
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(
                            dragOffset.width < 0
                                ? Color.red.opacity(Double(min(abs(dragOffset.width) / 150.0, 1.0)) * 0.8)
                                : borderColor.opacity(0.5),
                            lineWidth: 1.5
                        )
                )
                .shadow(color: .black.opacity(0.15), radius: 12, y: 4)

            VStack(spacing: 0) {
                if isFlipped {
                    cardBack(card: card, promptType: promptType)
                } else {
                    cardFront(card: card, promptType: promptType)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(24)

            // New badge
            if !isFlipped && isNewCard(card) {
                VStack {
                    HStack {
                        Text("New")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(.blue, in: Capsule())
                            .shadow(color: .blue.opacity(0.3), radius: 4)
                        Spacer()
                    }
                    Spacer()
                }
                .padding(16)
            }

            // Speaker button (front for recognition, back for all)
            VStack {
                HStack {
                    Spacer()
                    Button {
                        AudioPlayer.shared.play(wordId: card.id)
                    } label: {
                        Image(systemName: "speaker.wave.2.fill")
                            .font(.body)
                            .foregroundStyle(.primary.opacity(0.5))
                            .padding(10)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            .padding(12)
        }
        .onTapGesture {
            guard !submitting else { return }
            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                isFlipped.toggle()
            }
            if isFlipped {
                playOnFlip()
            }
        }
    }

    // MARK: - Card Front

    private func cardFront(card: SavedWord, promptType: PromptType) -> some View {
        VStack(spacing: 16) {
            switch promptType {
            case .recognition:
                Text(card.word)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .multilineTextAlignment(.center)
                cardImage(card: card)

            case .recall:
                Text(card.translation)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                if !card.definition.isEmpty {
                    Text(card.definition)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

            case .guidedCloze:
                if let sentenceTranslation = card.sentenceTranslation, !sentenceTranslation.isEmpty {
                    Text(renderTildeHighlight(sentenceTranslation))
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                } else {
                    Text(card.translation)
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                }
                if let example = card.exampleSentence {
                    Text(renderCloze(example))
                        .font(.title3)
                        .multilineTextAlignment(.center)
                }

            case .contextComprehension:
                if let example = card.exampleSentence {
                    Text(renderCloze(example))
                        .font(.title3)
                        .multilineTextAlignment(.center)
                }
                if let sentenceTranslation = card.sentenceTranslation, !sentenceTranslation.isEmpty {
                    Text(renderCloze(sentenceTranslation))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                } else {
                    Text(card.translation)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

            case .targetCloze:
                if let example = card.exampleSentence {
                    Text(renderCloze(example))
                        .font(.title3)
                        .multilineTextAlignment(.center)
                }
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
            case .recognition:
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
                if let example = card.exampleSentence, !example.isEmpty {
                    Text(renderTildeHighlight(example))
                        .font(.callout)
                        .multilineTextAlignment(.center)
                }
                if let sentenceTranslation = card.sentenceTranslation, !sentenceTranslation.isEmpty {
                    Text(sentenceTranslation)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

            case .recall:
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
                    Text(renderTildeHighlight(example))
                        .font(.callout)
                        .multilineTextAlignment(.center)
                }

            case .guidedCloze, .contextComprehension, .targetCloze:
                if let example = card.exampleSentence, !example.isEmpty {
                    Text(renderTildeHighlight(example))
                        .font(.title3)
                        .multilineTextAlignment(.center)
                }
                if let sentenceTranslation = card.sentenceTranslation, !sentenceTranslation.isEmpty {
                    Text(sentenceTranslation)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
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
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity, maxHeight: 160)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                default:
                    EmptyView()
                }
            }
        }
    }

    // MARK: - Answer Buttons

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
                dragOffset = value.translation
            }
            .onEnded { value in
                let threshold: CGFloat = 60

                if abs(value.translation.width) > threshold {
                    if !isFlipped {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                            isFlipped = true
                            dragOffset = .zero
                        }
                        playOnFlip()
                    } else {
                        let answer = value.translation.width > 0 ? "good" : "again"
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            dragOffset = .zero
                        }
                        Task { await handleAnswer(card: card, answer: answer) }
                    }
                } else {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        dragOffset = .zero
                    }
                }
            }
    }

    // MARK: - Audio

    private func autoPlayIfNeeded() {
        guard currentIndex < cards.count else { return }
        let card = cards[currentIndex]
        let pt = getPromptType(card: card)
        // Recognition: auto-play just the word on card appear
        if pt == .recognition && !audioPlayedForIndex.contains(currentIndex) {
            audioPlayedForIndex.insert(currentIndex)
            AudioPlayer.shared.play(wordId: card.id)
        }
    }

    private func playOnFlip() {
        guard currentIndex < cards.count else { return }
        let card = cards[currentIndex]
        let pt = getPromptType(card: card)
        guard !audioPlayedForIndex.contains(currentIndex) else { return }
        audioPlayedForIndex.insert(currentIndex)

        switch pt {
        case .recognition:
            // Already played on appear
            break
        case .recall, .guidedCloze, .contextComprehension, .targetCloze:
            // Play cached word audio (includes example sentence if available)
            AudioPlayer.shared.play(wordId: card.id)
        }
    }

    // MARK: - Actions

    private func load() async {
        loading = true
        do {
            cards = try await APIClient.shared.dueWords()
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func handleAnswer(card: SavedWord, answer: String) async {
        guard !submitting else { return }
        submitting = true

        let timeLabel = getButtonTimeLabel(card: card, answer: answer)
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            feedback = (answer: answer, text: timeLabel)
        }

        sessionStats.reviewed += 1
        if answer == "again" {
            sessionStats.incorrect += 1
        } else {
            sessionStats.correct += 1
        }

        let nextDue = getNextDueSeconds(card: card, answer: answer)
        let shouldRequeue = nextDue <= 600

        var updatedCard: SavedWord?
        do {
            updatedCard = try await APIClient.shared.reviewWord(id: card.id, answer: answer)
        } catch {
            print("[Polycast] Review error: \(error.localizedDescription)")
        }

        exitDirection = answer == "again" ? .leading : .trailing
        withAnimation(.easeIn(duration: 0.3)) {
            isExiting = true
        }

        try? await Task.sleep(nanoseconds: 700_000_000)

        withAnimation(.none) {
            feedback = nil
            isExiting = false
            isFlipped = false
            dragOffset = .zero

            if shouldRequeue {
                cards.append(updatedCard ?? card)
            }

            currentIndex += 1
            isEntering = true
        }

        submitting = false
        autoPlayIfNeeded()

        try? await Task.sleep(nanoseconds: 350_000_000)
        withAnimation {
            isEntering = false
        }
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
                        AsyncImage(url: url) { phase in
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

struct QuizView: View {
    let videoID: String?

    @State private var questions: [QuizQuestion] = []
    @State private var sessionID = ""
    @State private var currentIndex = 0
    @State private var userAnswer = ""
    @State private var feedback: QuizAnswerResult?
    @State private var results: QuizSessionResult?
    @State private var loading = true
    @State private var submitting = false
    @State private var error = ""

    init(videoID: String? = nil) {
        self.videoID = videoID
    }

    var body: some View {
        VStack(spacing: 18) {
            if loading {
                LoadingStateView(title: "Preparing quiz…")
            } else if let results {
                List {
                    Section("Score") {
                        Text("\(results.correctCount) / \(results.questionCount)")
                            .font(.largeTitle.bold())
                        Text("\(results.percentage)% correct")
                            .foregroundStyle(.secondary)
                    }
                    Section("Answers") {
                        ForEach(results.answers, id: \.questionIndex) { answer in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(answer.prompt)
                                    .font(.headline)
                                Text("You: \(answer.userAnswer)")
                                Text("Expected: \(answer.expectedAnswer)")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else if let question = questions[safe: currentIndex] {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Question \(currentIndex + 1) of \(questions.count)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Text(question.prompt)
                        .font(.title3.weight(.semibold))

                    if question.inputMode == "word_bank" {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(question.distractors, id: \.self) { word in
                                    Button(word) {
                                        appendWord(word)
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
                    }

                    TextField("Type your answer", text: $userAnswer, axis: .vertical)
                        .textFieldStyle(.roundedBorder)

                    if let feedback {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(feedback.isCorrect ? "Correct" : "Try again")
                                .font(.headline)
                                .foregroundStyle(feedback.isCorrect ? .green : .orange)
                            Text("Expected: \(feedback.expectedAnswer)")
                            Text(feedback.aiFeedback)
                                .foregroundStyle(.secondary)
                        }
                        .padding()
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                    }

                    if feedback == nil {
                        Button {
                            Task { await submit() }
                        } label: {
                            if submitting {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("Submit")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(userAnswer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || submitting)
                    } else {
                        Button("Next") {
                            Task { await goNext() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Mixed Quiz")
        .task {
            guard questions.isEmpty, results == nil else { return }
            await startQuiz()
        }
        .alert("Error", isPresented: .constant(!error.isEmpty), actions: {
            Button("OK") { error = "" }
        }, message: {
            Text(error)
        })
    }

    private func startQuiz() async {
        loading = true
        do {
            questions = try await APIClient.shared.generateQuiz(videoId: videoID)
            let mode = videoID == nil ? "standalone" : "video"
            sessionID = try await APIClient.shared.createQuizSession(mode: mode, questions: questions, videoId: videoID)
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func appendWord(_ word: String) {
        if userAnswer.isEmpty {
            userAnswer = word
        } else {
            userAnswer += " \(word)"
        }
    }

    private func submit() async {
        guard questions.indices.contains(currentIndex) else { return }
        submitting = true
        do {
            feedback = try await APIClient.shared.submitQuizAnswer(
                sessionId: sessionID,
                questionIndex: currentIndex,
                userAnswer: userAnswer.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        } catch {
            self.error = error.localizedDescription
        }
        submitting = false
    }

    private func goNext() async {
        if currentIndex + 1 >= questions.count {
            do {
                results = try await APIClient.shared.completeQuizSession(sessionId: sessionID)
            } catch {
                self.error = error.localizedDescription
            }
        } else {
            currentIndex += 1
            userAnswer = ""
            feedback = nil
        }
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
