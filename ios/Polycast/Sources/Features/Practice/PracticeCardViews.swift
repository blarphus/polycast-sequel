import SwiftUI
import WidgetKit

extension LearnView {
    var cardSessionView: some View {
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
    var handsFreeVolumeBar: some View {
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

    var progressCounter: some View {
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

    var cardOffsetX: CGFloat {
        if isExiting {
            let distance = UIScreen.main.bounds.width + 260
            return exitDirection == .trailing ? distance : -distance
        }
        return dragOffset.width
    }

    var cardRotationDegrees: Double {
        if isExiting {
            return exitDirection == .trailing ? 26 : -26
        }
        return Double(dragOffset.width) * 0.03
    }

    func cardView(card: SavedWord, promptType: PromptType) -> some View {
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

    func cardFace(card: SavedWord, promptType: PromptType, isBack: Bool) -> some View {
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

    func cardBadges(card: SavedWord, isBack: Bool) -> some View {
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

    func cardAudioControls(card: SavedWord, promptType: PromptType, isBack: Bool) -> some View {
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

    func cardFront(card: SavedWord, promptType: PromptType) -> some View {
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

    func cardBack(card: SavedWord, promptType: PromptType) -> some View {
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
    func cardImage(card: SavedWord) -> some View {
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
    func displayStage(_ card: SavedWord) -> Int {
        card.promptStage ?? 0
    }

    /// The stage this answer moves the card to.
    func nextStageLabel(card: SavedWord, answer: String) -> String {
        "Stage \(nextPromptStage(card: card, answer: answer))"
    }

    func answerButtons(card: SavedWord) -> some View {
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

    func feedbackOverlay(_ fb: (answer: String, text: String)) -> some View {
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

    func dragGesture(card: SavedWord) -> some Gesture {
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

}
