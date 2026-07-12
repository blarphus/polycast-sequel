import SwiftUI
import WidgetKit

extension LearnView {
    func spokenText(card: SavedWord, promptType: PromptType, back: Bool) -> String? {
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

    func speakCurrentSide(card: SavedWord, promptType: PromptType) {
        guard let text = spokenText(card: card, promptType: promptType, back: isFlipped) else { return }
        if text == card.word {
            // Word-only: use the per-word clip cached server-side.
            AudioPlayer.shared.play(wordId: card.id)
        } else {
            AudioPlayer.shared.speakText(text, languageCode: card.targetLanguage)
        }
    }

    /// Double-tap handler: replay the audio for the side currently showing.
    func replayCurrentSideAudio(card: SavedWord, promptType: PromptType) {
        if handsFree {
            if isFlipped { handsFreeReadAnswer(card: card) } else { handsFreeAnnounceCurrent() }
        } else {
            speakCurrentSide(card: card, promptType: promptType)
        }
    }

    /// Pre-fetch audio for the current card and the next few cards, including
    /// hands-free prompt/answer fragments. Answer fragments are queued first so
    /// the reverse side is ready by the time the learner reveals the card.
    func preloadUpcomingAudio(from start: Int) {
        guard start < cards.count else { return }
        let end = min(start + 6, cards.count)
        preloadAudio(for: Array(cards[start..<end]))
    }

    /// Pre-fetch both the per-word clips and every TTS fragment a card may
    /// speak, so card fronts, reveals, and hands-free repeats do not wait on
    /// synthesis.
    func preloadAudio(for cards: [SavedWord]) {
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
    func prefetchUpcomingImages(from start: Int) {
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
    func configureHandsFree() {
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
    func handleHandsFreeEvent(_ event: HandsFreeController.Event) {
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

    func handsFreeReveal(card: SavedWord) {
        AudioPlayer.shared.stop()
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { isFlipped = true }
        handsFreeReadAnswer(card: card)
    }

    /// Speak the current card's prompt, using the NATIVE voice for instruction
    /// text and the TARGET voice for any target-language word/sentence.
    func handsFreeAnnounceCurrent() {
        guard handsFree, currentIndex < cards.count else { return }
        let card = cards[currentIndex]
        let parts = handsFreePromptParts(card: card)
        let title = parts.map(\.text).joined(separator: " ")
        HandsFreeController.shared.setNowPlaying(title, subtitle: "Press play to reveal")
        AudioPlayer.shared.speakSequence(parts)
    }

    /// Read the answer side aloud after a reveal, each part in its own voice.
    func handsFreeReadAnswer(card: SavedWord) {
        AudioPlayer.shared.speakSequence(handsFreeAnswerParts(card: card))
    }

    var nativeLang: String? { session.user?.nativeLanguage }
    var targetLang: String? { session.user?.targetLanguage }

    /// The prompt, split so each part is spoken in the right language/voice.
    func handsFreePromptParts(card: SavedWord) -> [(text: String, languageCode: String?)] {
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
    func handsFreeAnswerParts(card: SavedWord) -> [(text: String, languageCode: String?)] {
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

    func autoPlayIfNeeded() {
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

    func playOnFlip() {
        guard !audioMuted, currentIndex < cards.count else { return }
        let card = cards[currentIndex]
        let key = "\(currentIndex)-back"
        guard !audioPlayedForSide.contains(key) else { return }
        audioPlayedForSide.insert(key)
        speakCurrentSide(card: card, promptType: getPromptType(card: card))
    }

    // MARK: - Actions

    func load() async {
        loading = true
        do {
            cards = try await APIClient.shared.dueWords()
            wordStore.upsert(contentsOf: cards)
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    func loadInitialSession() async {
        loading = true
        loadingRemainingSession = false
        checkingForMore = false
        currentIndex = 0
        do {
            cards = try await APIClient.shared.dueWords(limit: initialSessionCardLimit, offset: 0)
            wordStore.upsert(contentsOf: cards)
        } catch {
            self.error = error.localizedDescription
            cards = []
        }
        loading = false
    }

    func loadRemainingSession(startingAfter offset: Int) async {
        guard offset > 0, !loadingRemainingSession else { return }
        loadingRemainingSession = true
        do {
            let more = try await APIClient.shared.dueWords(offset: offset)
            appendUnseenCards(more)
        } catch {
            PolycastLog.runtime.error("[Polycast] Failed to load remaining practice cards: \(error)")
        }
        loadingRemainingSession = false

        preloadUpcomingAudio(from: currentIndex)
        prefetchUpcomingImages(from: currentIndex)
    }

    func appendUnseenCards(_ more: [SavedWord]) {
        guard !more.isEmpty else { return }
        let knownIDs = Set(cards.map(\.id))
        let unseen = more.filter { !knownIDs.contains($0.id) }
        guard !unseen.isEmpty else { return }
        cards.append(contentsOf: unseen)
        wordStore.upsert(contentsOf: unseen)
    }

    func handleAnswer(card: SavedWord, answer: String) async {
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
                let more = try await APIClient.shared.dueWords()
                let previousCount = cards.count
                appendUnseenCards(more)
                if cards.count == previousCount {
                    WidgetCenter.shared.reloadAllTimelines()
                }
            } catch {
                PolycastLog.runtime.error("[Polycast] Failed to check for more cards: \(error)")
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

    func submitReview(card: SavedWord, answer: String) async {
        do {
            _ = try await APIClient.shared.reviewWord(id: card.id, answer: answer)
            PracticeStartCache.snapshot = nil
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            PolycastLog.runtime.error("[Polycast] Review error: \(error.localizedDescription)")
        }
    }

}

func upcomingNewWords(from words: [SavedWord]) -> [SavedWord] {
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
