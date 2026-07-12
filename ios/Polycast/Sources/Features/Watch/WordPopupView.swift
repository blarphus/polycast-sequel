import SwiftUI

private struct PopupContentHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}
struct WordPopupView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore
    @ObservedObject private var dailyGoal = DailyWordGoalStore.shared

    let context: LookupContext
    let onDismiss: () -> Void

    @State private var lookup: LookupResponse?
    @State private var saved = false
    @State private var savedWordId: String?
    @State private var error = ""
    @State private var explanation: String?
    @State private var explaining = false
    @State private var initialSavedHint = false
    @State private var measuredContentHeight: CGFloat = 0
    @State private var confirmingRemoval = false
    @State private var removingFromDictionary = false
    // 'word' adds the single clicked word; 'phrase' adds a detected phrase/idiom.
    @State private var mode: PopupMode = .word

    private enum PopupMode { case word, phrase }

    // Web popup palette (shared/wordPopup.css).
    private let cardBackground = Color(red: 0.102, green: 0.102, blue: 0.180) // #1a1a2e
    private let accent = Color(red: 0.424, green: 0.388, blue: 1.0)           // #6c63ff
    private let lightPurple = Color(red: 0.655, green: 0.545, blue: 0.980)    // #a78bfa
    private let bodyText = Color(red: 0.878, green: 0.878, blue: 0.878)       // #e0e0e0
    private let definitionText = Color(red: 0.690, green: 0.690, blue: 0.784) // #b0b0c8
    private let lemmaText = Color(red: 0.843, green: 0.827, blue: 1.0)        // #d7d3ff
    private let closeGray = Color(red: 0.502, green: 0.502, blue: 0.596)      // #808098
    private let savedGreen = Color(red: 0.290, green: 0.871, blue: 0.502)     // #4ade80
    private let errorRed = Color(red: 0.973, green: 0.443, blue: 0.443)       // #f87171

    var body: some View {
        GeometryReader { geometry in
            let cardWidth = min(360, max(280, geometry.size.width - 40))
            let maxCardHeight = max(180, geometry.size.height - 24)
            // The card is sized to exactly its content's measured height (capped
            // to the screen), so there's no extra vertical space. A ScrollView
            // alone won't hug its content reliably, so we measure it ourselves.
            let cardHeight: CGFloat? = measuredContentHeight > 0
                ? min(measuredContentHeight, maxCardHeight)
                : nil

            ZStack {
                Color.black.opacity(0.55)
                    .ignoresSafeArea()
                    .onTapGesture { onDismiss() }

                ScrollView {
                    popupContent
                        .background(
                            GeometryReader { proxy in
                                Color.clear.preference(
                                    key: PopupContentHeightKey.self,
                                    value: proxy.size.height
                                )
                            }
                        )
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(width: cardWidth)
                .frame(height: cardHeight)
                .onPreferenceChange(PopupContentHeightKey.self) { measuredContentHeight = $0 }
                .background(cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(accent.opacity(0.3), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.5), radius: 16, y: 8)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("word-popup-card")
            }
        }
        .animation(.easeOut(duration: 0.15), value: lookup != nil)
        .onAppear {
            initialSavedHint = wordStore.savedForms.contains(savedWordMatchKey(context.word))
        }
        .alert("Remove \(removalLabel) from dictionary?", isPresented: $confirmingRemoval) {
            Button("Cancel", role: .cancel) { }
            Button("Remove", role: .destructive) {
                Task { await removeFromDictionary() }
            }
        }
        .task {
            guard lookup == nil && error.isEmpty else { return }
            await load()
        }
    }

    private var popupContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            header

            if let lookup {
                lookupBody(lookup)
                    .accessibilityIdentifier("word-popup-loaded")
            } else if !error.isEmpty {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(errorRed)
                    .accessibilityIdentifier("word-popup-error")
            } else {
                HStack(spacing: 8) {
                    ProgressView().tint(accent)
                    Text("Looking up…")
                        .font(.system(size: 13))
                        .foregroundStyle(definitionText)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .accessibilityIdentifier("word-popup-loading")
            }
        }
        .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
    }

    private var header: some View {
        HStack(spacing: 2) {
            Text(context.word)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(accent)

            if saved || (lookup == nil && initialSavedHint) {
                Text("IN DICTIONARY")
                    .font(.system(size: 9, weight: .bold))
                    .kerning(0.4)
                    .foregroundStyle(savedGreen)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(savedGreen.opacity(0.12), in: Capsule())
            }

            Spacer()

            if lookup != nil {
                Button {
                    AudioPlayer.shared.speakText(context.word, languageCode: session.user?.targetLanguage)
                } label: {
                    Image(systemName: "speaker.wave.2")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(lightPurple)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
            }

            Button { onDismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(closeGray)
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
        }
        .padding(.bottom, 10)
    }

    /// True when the clicked word is part of a fixed phrase/idiom worth offering.
    private func hasPhrase(_ lookup: LookupResponse) -> Bool {
        guard lookup.isPhrase == true, let phrase = lookup.phrase, !phrase.isEmpty else { return false }
        return phrase.caseInsensitiveCompare(context.word) != .orderedSame
    }

    @ViewBuilder
    private func lookupBody(_ lookup: LookupResponse) -> some View {
        if hasPhrase(lookup) {
            phraseToggle
                .padding(.bottom, 10)
        }

        if hasPhrase(lookup), mode == .phrase {
            phraseContent(lookup)
        } else {
            wordContent(lookup)
        }

        dailyGoalProgress

        Button {
            Task { await explain(lookup) }
        } label: {
            Group {
                if explaining {
                    ProgressView().controlSize(.small).tint(lightPurple)
                } else {
                    Text("Explain in context")
                }
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(bodyText)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(lightPurple.opacity(0.4), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .disabled(explaining)
        .padding(.top, 10)

        if let explanation {
            VStack(alignment: .leading, spacing: 0) {
                Rectangle()
                    .fill(.white.opacity(0.08))
                    .frame(height: 1)
                    .padding(.bottom, 8)
                Text(renderTildeHighlight(
                    explanation,
                    baseColor: Color(red: 0.816, green: 0.816, blue: 0.878),
                    highlightColor: .yellow
                ))
                    .font(.system(size: 13))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 8)
        }

        if lookupHasContent(lookup) {
            Button {
                if saved {
                    confirmingRemoval = true
                } else {
                    save(lookup)
                }
            } label: {
                HStack(spacing: 5) {
                    if removingFromDictionary {
                        ProgressView().controlSize(.small).tint(savedGreen)
                    } else if saved {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                        Text("In dictionary")
                    } else {
                        Text(hasPhrase(lookup) && mode == .phrase ? "+ Add phrase" : "+ Add to dictionary")
                    }
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(saved ? savedGreen : bodyText)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(saved ? savedGreen : accent.opacity(0.4), lineWidth: 1)
                )
                .contentShape(Rectangle())
            }
            .disabled(removingFromDictionary || (saved && savedWordId == nil))
            .padding(.top, 10)
        }

        if !error.isEmpty {
            Text(error)
                .font(.system(size: 13))
                .foregroundStyle(errorRed)
                .padding(.top, 8)
        }
    }

    private var dailyGoalProgress: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(dailyGoal.isComplete
                     ? "Daily goal complete"
                     : "\(dailyGoal.remaining) more \(dailyGoal.remaining == 1 ? "word" : "words") today")
                Spacer()
                Text("\(dailyGoal.addedToday)/\(dailyGoal.goal)")
                    .fontWeight(.bold)
                    .foregroundStyle(dailyGoal.isComplete ? .yellow : .teal)
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(definitionText)

            ProgressView(value: dailyGoal.progress)
                .tint(dailyGoal.isComplete ? .yellow : .teal)
        }
        .padding(10)
        .background((dailyGoal.isComplete ? Color.yellow : Color.teal).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke((dailyGoal.isComplete ? Color.yellow : Color.teal).opacity(0.24))
        }
        .padding(.top, 10)
        .animation(.spring(response: 0.35, dampingFraction: 0.7), value: dailyGoal.addedToday)
    }

    private var phraseToggle: some View {
        HStack(spacing: 2) {
            ForEach([PopupMode.word, PopupMode.phrase], id: \.self) { m in
                Button {
                    guard mode != m else { return }
                    mode = m
                    // Each form can be added independently.
                    saved = false
                    savedWordId = nil
                    error = ""
                } label: {
                    Text(m == .word ? "Word" : "Phrase")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(mode == m ? Color.white : definitionText)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(
                            mode == m ? lightPurple.opacity(0.28) : Color.clear,
                            in: RoundedRectangle(cornerRadius: 6)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private func wordContent(_ lookup: LookupResponse) -> some View {
        if let lemma = lookup.lemma,
           !lemma.isEmpty,
           lemma.caseInsensitiveCompare(context.word) != .orderedSame {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("SAVES AS")
                    .font(.system(size: 10, weight: .bold))
                    .kerning(0.5)
                    .foregroundStyle(accent)
                Text(lemma)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(lemmaText)
            }
            .padding(.bottom, 10)
        }

        // Mirror the web popup's empty-response handling so a flaky Gemini
        // reply never renders a blank popup.
        if !lookup.valid {
            Text("Not a recognized word")
                .font(.system(size: 13))
                .foregroundStyle(errorRed)
        } else if !lookupHasContent(lookup) {
            Text("No definition found")
                .font(.system(size: 13))
                .foregroundStyle(errorRed)
        } else {
            // Like the web: fall back to the definition when the translation
            // field came back empty.
            let translationText = lookup.translation.isEmpty ? lookup.definition : lookup.translation
            if !translationText.isEmpty {
                Text(translationText)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.bottom, 6)
            }

            if let pos = lookup.partOfSpeech, !pos.isEmpty {
                Text(pos.uppercased())
                    .font(.system(size: 11))
                    .kerning(0.5)
                    .foregroundStyle(lightPurple)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(lightPurple.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
                    .padding(.bottom, 6)
            }

            if !lookup.definition.isEmpty, lookup.definition != translationText {
                Text(lookup.definition)
                    .font(.system(size: 13))
                    .foregroundStyle(definitionText)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func phraseContent(_ lookup: LookupResponse) -> some View {
        Text(lookup.phrase ?? "")
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(.white)
            .padding(.bottom, 6)

        if let pt = lookup.phraseTranslation, !pt.isEmpty {
            Text(pt)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(bodyText)
                .padding(.bottom, 6)
        }

        Text("PHRASE")
            .font(.system(size: 11))
            .kerning(0.5)
            .foregroundStyle(lightPurple)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(lightPurple.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
            .padding(.bottom, 6)

        if let pd = lookup.phraseDefinition, !pd.isEmpty {
            Text(pd)
                .font(.system(size: 13))
                .foregroundStyle(definitionText)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Matches the web popup's guard: a lookup with no translation, definition,
    /// or part of speech has nothing to show (or save).
    private func lookupHasContent(_ lookup: LookupResponse) -> Bool {
        lookup.valid && !(lookup.translation.isEmpty && lookup.definition.isEmpty && (lookup.partOfSpeech ?? "").isEmpty)
    }


    private func load() async {
        guard let user = session.user else {
            error = "Sign in to look up this word."
            return
        }
        do {
            lookup = try await APIClient.shared.lookupWord(
                word: context.word,
                sentence: context.sentence,
                nativeLang: user.nativeLanguage ?? "en",
                targetLang: user.targetLanguage
            )
            saved = lookup?.isExisting == true
            savedWordId = lookup?.savedWordId
            // Self-heal highlighting: if the tapped form belongs to an already-saved
            // word but wasn't among its stored inflections, persist it so this exact
            // form highlights everywhere (here, the reader, and on future loads).
            if let lookup, lookup.isExisting == true, let id = lookup.savedWordId {
                await selfHealForm(savedWordId: id)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func selfHealForm(savedWordId: String) async {
        let form = savedWordMatchKey(context.word)
        guard !wordStore.savedForms.contains(form) else { return }
        do {
            let updated = try await APIClient.shared.addWordForm(id: savedWordId, form: context.word)
            wordStore.upsert(updated)
        } catch {
            PolycastLog.runtime.error("[Polycast] Could not persist encountered form: \(error.localizedDescription)")
        }
    }

    private func explain(_ lookup: LookupResponse) async {
        explaining = true
        do {
            let response = try await APIClient.shared.explainWord(
                word: lookup.word,
                sentence: context.sentence,
                nativeLang: session.user?.nativeLanguage ?? "en",
                targetLang: session.user?.targetLanguage,
                context: context.context
            )
            explanation = response.explanation
            error = ""
        } catch {
            self.error = error.localizedDescription
        }
        explaining = false
    }

    private var removalLabel: String {
        guard let lookup else { return context.word }
        if hasPhrase(lookup), mode == .phrase {
            return lookup.phrase ?? context.word
        }
        return lookup.lemma?.isEmpty == false ? (lookup.lemma ?? context.word) : context.word
    }

    private func removeFromDictionary() async {
        guard let id = savedWordId else {
            error = "This word is still saving. Try again in a moment."
            return
        }
        removingFromDictionary = true
        error = ""
        do {
            try await APIClient.shared.deleteWord(id: id)
            wordStore.remove(id: id)
            saved = false
            savedWordId = nil
            initialSavedHint = false
        } catch {
            self.error = error.localizedDescription
        }
        removingFromDictionary = false
    }

    /// Optimistic save, matching the web app: mark the word saved and highlight
    /// it instantly, then run the slow enrichment + save in the background and
    /// swap in the server's row when it lands.
    private func save(_ lookup: LookupResponse) {
        guard !saved else { return }
        saved = true
        savedWordId = nil
        error = ""

        let native = session.user?.nativeLanguage ?? "en"
        let target = session.user?.targetLanguage
        let sentence = context.sentence

        // When the learner picked the phrase, save the whole phrase as the base
        // form (no lemma/inflections); otherwise save the single clicked word.
        let usePhrase = hasPhrase(lookup) && mode == .phrase
        let savedSurface = usePhrase ? (lookup.phrase ?? context.word) : context.word
        let placeholderTranslation = usePhrase ? (lookup.phraseTranslation ?? "") : lookup.translation
        let placeholderDefinition = usePhrase ? (lookup.phraseDefinition ?? "") : lookup.definition
        // The form fed to enrichment: the phrase itself, or the word's lemma.
        let enrichWordValue = usePhrase ? savedSurface : (lookup.lemma ?? lookup.word)

        // Keep the exact surface form the learner tapped in the optimistic row.
        // The lemma and full inflection list arrive later from enrichment.
        let tempId = "optimistic-\(UUID().uuidString)"
        let placeholder = SavedWord(
            id: tempId,
            word: savedSurface,
            translation: placeholderTranslation,
            definition: placeholderDefinition,
            targetLanguage: target,
            sentenceContext: sentence,
            createdAt: ISO8601DateFormatter().string(from: .now),
            frequency: nil,
            frequencyCount: nil,
            exampleSentence: usePhrase ? nil : lookup.example,
            sentenceTranslation: usePhrase ? nil : lookup.sentenceTranslation,
            partOfSpeech: usePhrase ? nil : lookup.partOfSpeech,
            srsInterval: 0,
            dueAt: nil,
            lastReviewedAt: nil,
            correctCount: 0,
            incorrectCount: 0,
            easeFactor: 2.5,
            learningStep: nil,
            promptStage: 0,
            imageUrl: nil,
            lemma: usePhrase ? nil : lookup.lemma,
            forms: nil,
            priority: false,
            imageTerm: nil,
            queuePosition: nil,
            introducedDate: nil,
            relearningDate: nil,
            stageSentences: nil
        )
        wordStore.insert(placeholder)

        Task {
            do {
                // Enrich (frequency, image, inflected forms) before saving, matching the web reader.
                let enriched = try await APIClient.shared.enrichWord(
                    word: enrichWordValue,
                    sentence: sentence,
                    nativeLang: native,
                    targetLang: target
                )
                let savedWord = try await APIClient.shared.saveWord(
                    word: enriched.word,
                    translation: enriched.translation,
                    definition: enriched.definition,
                    targetLanguage: target,
                    sentenceContext: sentence,
                    frequency: enriched.frequency,
                    frequencyCount: enriched.frequencyCount,
                    exampleSentence: enriched.exampleSentence,
                    sentenceTranslation: enriched.sentenceTranslation,
                    partOfSpeech: enriched.partOfSpeech,
                    imageUrl: enriched.imageUrl,
                    lemma: enriched.lemma,
                    forms: enriched.forms,
                    surfaceForm: savedSurface,
                    imageTerm: enriched.imageTerm
                )
                wordStore.remove(id: tempId)
                wordStore.insert(savedWord)
                savedWordId = savedWord.id
            } catch {
                // Roll back the optimistic row and surface the failure.
                PolycastLog.runtime.error("[Polycast] Save word failed: \(error.localizedDescription)")
                wordStore.remove(id: tempId)
                saved = false
                savedWordId = nil
                self.error = error.localizedDescription
            }
        }
    }
}
