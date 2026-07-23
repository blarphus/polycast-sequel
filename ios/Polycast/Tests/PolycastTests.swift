import XCTest
@testable import Polycast

final class PolycastTests: XCTestCase {
    func testLanguageOptionsContainExpectedDefaults() {
        XCTAssertTrue(LanguageOptions.all.contains { $0.code == "en" })
        XCTAssertTrue(LanguageOptions.all.contains { $0.code == "es" })
        XCTAssertEqual(LanguageOptions.cefrLevels, ["A1", "A2", "B1", "B2", "C1", "C2"])
    }

    func testNewsArticleUsesLinkAsIdentifier() {
        let article = NewsArticle(
            originalTitle: "Original",
            simplifiedTitle: "Simplified",
            difficulty: "B1",
            source: "DW",
            link: "https://example.com/article",
            image: nil,
            preview: nil
        )

        XCTAssertEqual(article.id, article.link)
    }

    func testDictionaryImageURLResolvesServerRelativeCachedImage() {
        let url = APIClient.proxyImageURL("/api/dictionary/image/123")

        XCTAssertEqual(url?.absoluteString, "https://polycast-sequel.onrender.com/api/dictionary/image/123")
    }

    func testDictionaryImageURLProxiesPixabayImages() {
        let source = "https://pixabay.com/get/example image.jpg"
        let url = APIClient.proxyImageURL(source)
        let components = url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }

        XCTAssertEqual(components?.path, "/api/dictionary/image-proxy")
        XCTAssertEqual(components?.queryItems?.first(where: { $0.name == "url" })?.value, source)
    }

    func testDictionaryImageRequestIncludesTokenOnlyForAPIOrigin() {
        let client = APIClient.shared
        let previousToken = client.token
        client.token = "test-token"
        defer { client.token = previousToken }

        let apiURL = URL(string: "https://polycast-sequel.onrender.com/api/dictionary/image/123")!
        let externalURL = URL(string: "https://example.com/image.jpg")!

        XCTAssertEqual(client.authorizedRequest(for: apiURL).value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertNil(client.authorizedRequest(for: externalURL).value(forHTTPHeaderField: "Authorization"))
    }

    @MainActor
    func testUnauthorizedResponseInvalidatesSessionOnceWithVisibleDiagnostic() async {
        let client = APIClient.shared
        let previousToken = client.token
        defer { client.token = previousToken }
        client.token = "expired-test-token"

        let notification = expectation(
            forNotification: APIClient.sessionExpiredNotification,
            object: client
        ) { event in
            event.userInfo?["path"] as? String == "/dictionary/words"
        }

        client.invalidateSessionAfterUnauthorizedResponse(path: "/dictionary/words")
        client.invalidateSessionAfterUnauthorizedResponse(path: "/progression")
        await fulfillment(of: [notification], timeout: 2)

        XCTAssertNil(client.token)
        XCTAssertEqual(FallbackNoticeCenter.shared.notice?.code, "session_expired")
        XCTAssertEqual(FallbackNoticeCenter.shared.notice?.severity, "error")
        XCTAssertEqual(FallbackNoticeCenter.shared.notice?.source, "ios.api")
        XCTAssertEqual(FallbackNoticeCenter.shared.notice?.operation, "invalidate-session")
        XCTAssertTrue(FallbackNoticeCenter.shared.notice?.detail?.contains("status=401") == true)
    }

    func testReaderPaginationProducesOrderedFixedPagesWithoutLosingText() {
        let sentences = (1...80).map {
            "Sentence \($0) contains enough words to exercise the mobile reader pagination."
        }
        let chapter = BookChapter(
            title: "Chapter One",
            blocks: [
                BookBlock(kind: .h1, sentences: ["Chapter One"]),
                BookBlock(kind: .p, sentences: sentences),
            ]
        )

        let layout = ReaderLayout(
            width: 350,
            height: 600,
            fontScale: 1,
            font: .defaultChoice,
            lineSpacing: ReaderLineSpacing.normal.value
        )
        let pages = paginate(chapters: [chapter], layout: layout)

        XCTAssertGreaterThan(pages.count, 1)
        XCTAssertEqual(pages.map(\.id), Array(pages.indices))
        XCTAssertTrue(pages.allSatisfy { !$0.blocks.isEmpty && $0.chapterIndex == 0 })

        let renderedText = pages
            .flatMap(\.blocks)
            .map(\.block.plainText)
            .joined(separator: " ")
        let sourceText = chapter.blocks.map(\.plainText).joined(separator: " ")
        XCTAssertEqual(renderedText, sourceText)
    }

    func testReaderPaginationIndentsParagraphsAfterParagraphs() {
        let chapter = BookChapter(
            title: "Chapter One",
            blocks: [
                BookBlock(kind: .h1, sentences: ["Chapter One"]),
                BookBlock(kind: .p, sentences: ["First paragraph after the heading stays flush."]),
                BookBlock(kind: .p, sentences: ["Second paragraph gets a first-line indent."]),
            ]
        )

        let layout = ReaderLayout(
            width: 350,
            height: 600,
            fontScale: 1,
            font: .defaultChoice,
            lineSpacing: ReaderLineSpacing.normal.value
        )
        let blocks = paginate(chapters: [chapter], layout: layout).flatMap(\.blocks)

        XCTAssertEqual(blocks.map(\.indentFirstLine), [false, false, true])
        // Consecutive paragraphs run together (indent separates them, like print).
        XCTAssertEqual(blocks[2].topSpacing, 0)
        XCTAssertGreaterThan(blocks[1].topSpacing, 0)
    }

    func testUnfinishedLearningCardStaysInLearningQueueAcrossDays() {
        let card = makeSRSCard(
            srsInterval: 86_400,
            lastReviewedAt: "2026-06-10T15:00:00Z",
            learningStep: 0
        )

        XCTAssertEqual(studyQueueBucket(card: card), .review)
    }

    func testFailedNewAndReviewCardsMoveToLearningQueue() {
        let newCard = makeSRSCard()
        let reviewCard = makeSRSCard(
            srsInterval: 86_400,
            lastReviewedAt: "2026-06-10T15:00:00Z"
        )

        XCTAssertEqual(studyQueueBucket(card: applyAnswerLocally(card: newCard, answer: "again")), .learning)
        XCTAssertEqual(studyQueueBucket(card: applyAnswerLocally(card: reviewCard, answer: "again")), .learning)
    }

    func testRelearningAdvancesAfterOneCorrectAnswer() {
        let card = makeSRSCard(
            srsInterval: 86_400,
            lastReviewedAt: ISO8601DateFormatter().string(from: .now),
            learningStep: 0,
            relearningDate: localTestDateKey()
        )
        let updated = applyAnswerLocally(card: card, answer: "good")

        XCTAssertEqual(updated.learningStep, 1)
        XCTAssertEqual(getNextDueSeconds(card: card, answer: "good"), 600)
        XCTAssertEqual(studyQueueBucket(card: updated), .review)
    }

    func testFinalRelearningStepGraduatesAfterCorrectAnswer() {
        let card = makeSRSCard(
            srsInterval: 86_400,
            lastReviewedAt: ISO8601DateFormatter().string(from: .now),
            learningStep: 1,
            relearningDate: localTestDateKey()
        )
        let updated = applyAnswerLocally(card: card, answer: "good")

        XCTAssertNil(updated.learningStep)
        XCTAssertEqual(getNextDueSeconds(card: card, answer: "good"), 86_400)
        XCTAssertEqual(studyQueueBucket(card: updated), .review)
    }

    func testLearningCountUsesDistinctCardsAndIgnoresDuplicates() {
        let reviewedNow = ISO8601DateFormatter().string(from: .now)
        let firstStep = makeSRSCard(lastReviewedAt: reviewedNow, learningStep: 0, relearningDate: localTestDateKey())
        let secondStep = makeSRSCard(id: "card-2", lastReviewedAt: reviewedNow, learningStep: 1, relearningDate: localTestDateKey())
        let counts = studyQueueCounts(cards: [firstStep, secondStep, firstStep][...])

        XCTAssertEqual(counts, StudyQueueCounts(new: 0, learning: 2, review: 0))
    }

    func testOrdinaryNewCardLearningRemainsBlue() {
        let updated = applyAnswerLocally(card: makeSRSCard(), answer: "good")

        XCTAssertEqual(updated.learningStep, 1)
        XCTAssertEqual(studyQueueBucket(card: updated), .new)
        XCTAssertEqual(studyQueueCounts(cards: [updated][...]), StudyQueueCounts(new: 1, learning: 0, review: 0))
    }

    func testCanonicalSRSGoldenFixtures() {
        for fixture in GeneratedSRSContract.goldenFixtures {
            let card = makeSRSCard(
                srsInterval: fixture.card.srsInterval,
                lastReviewedAt: fixture.card.srsInterval > 0 ? "2026-06-01T00:00:00Z" : nil,
                learningStep: fixture.card.learningStep
            ).withSRSContractState(fixture.card)
            let updated = applyAnswerLocally(card: card, answer: fixture.answer)

            XCTAssertEqual(updated.srsInterval, fixture.expected.srsInterval, fixture.name)
            XCTAssertEqual(updated.easeFactor, fixture.expected.easeFactor, accuracy: 0.000_001, fixture.name)
            XCTAssertEqual(updated.learningStep, fixture.expected.learningStep, fixture.name)
            XCTAssertEqual(getNextDueSeconds(card: card, answer: fixture.answer), fixture.expected.dueSeconds, fixture.name)
            XCTAssertEqual(updated.correctCount, fixture.expected.correctDelta, fixture.name)
            XCTAssertEqual(updated.incorrectCount, fixture.expected.incorrectDelta, fixture.name)
            XCTAssertEqual(updated.promptStage, fixture.expected.promptStage, fixture.name)
        }
    }

    func testFailingRelearningCardAgainKeepsOneRedCard() {
        let reviewedNow = ISO8601DateFormatter().string(from: .now)
        let card = makeSRSCard(srsInterval: 86_400, lastReviewedAt: reviewedNow, learningStep: 0, relearningDate: localTestDateKey())
        let failedAgain = applyAnswerLocally(card: card, answer: "again")

        XCTAssertEqual(studyQueueCounts(cards: [card][...]).learning, 1)
        XCTAssertEqual(studyQueueCounts(cards: [failedAgain][...]).learning, 1)
    }

    func testFailedOneMonthReviewResetsToOneDayAfterRelearning() {
        let card = makeSRSCard(srsInterval: 30 * 86_400, lastReviewedAt: "2026-05-11T15:00:00Z")
        let failed = applyAnswerLocally(card: card, answer: "again")

        XCTAssertEqual(failed.learningStep, 0)
        XCTAssertEqual(failed.srsInterval, 86_400)
        XCTAssertEqual(getNextDueSeconds(card: card, answer: "again"), 60)
    }

    func testDayIntervalIsScheduledAtLocalMidnight() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = ISO8601DateFormatter().date(from: "2026-06-11T22:30:00Z")!
        let card = makeSRSCard(
            lastReviewedAt: "2026-06-11T22:00:00Z",
            learningStep: 1
        )
        let graduated = applyAnswerLocally(card: card, answer: "good", now: now, calendar: calendar)

        XCTAssertEqual(graduated.dueAt, "2026-06-12T00:00:00Z")
    }

    func testMinuteLearningStepUsesExactElapsedTime() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = ISO8601DateFormatter().date(from: "2026-06-11T22:30:00Z")!
        let failed = applyAnswerLocally(card: makeSRSCard(), answer: "again", now: now, calendar: calendar)
        let due = ISO8601DateFormatter().date(from: failed.dueAt!)!

        XCTAssertEqual(due.timeIntervalSince(now), 60, accuracy: 0.001)
    }

    func testOptimisticSavedWordHighlightsTappedSurfaceFormBeforeFormsLoad() {
        let tappedForm = makeSRSCard(word: "supo", lemma: "saber")

        XCTAssertTrue(savedWordForms([tappedForm]).contains("supo"))
        XCTAssertTrue(savedWordForms([tappedForm]).contains("saber"))
    }

    func testDueStatusParsesFractionalSecondServerTimestamps() {
        let card = makeSRSCard(dueAt: "2026-06-20T00:00:00.000Z")

        XCTAssertNotEqual(getDueStatus(card).label, "Unscheduled")
    }

    func testLookupResponseDecodesExistingSenseMetadata() throws {
        let data = #"{"word":"supo","target_word":"supo","valid":true,"translation":"found out","definition":"learned","part_of_speech":"verb","lemma":"saber","is_native":false,"is_existing":true,"saved_word_id":"saved-1","definition_source":"user","example":null,"example_translation":null,"sentence_translation":null}"#.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let lookup = try decoder.decode(LookupResponse.self, from: data)

        XCTAssertEqual(lookup.isExisting, true)
        XCTAssertEqual(lookup.savedWordId, "saved-1")
    }

    func testCanonicalAuthFixturesDecodeAndRequiredFieldsFailClosed() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let session = try decoder.decode(AuthResponse.self, from: Data(apiGoldenAuthSessionJSON.utf8))
        XCTAssertEqual(session.id, "11111111-1111-4111-8111-111111111111")
        XCTAssertEqual(session.user.dailyNewLimit, 5)
        XCTAssertEqual(session.user.accountType, "student")

        let missingRequired = apiGoldenAuthUserJSON.replacingOccurrences(of: "\"total_xp\":120,", with: "")
        XCTAssertThrowsError(try decoder.decode(AuthUser.self, from: Data(missingRequired.utf8)))
    }

    func testCanonicalFallbackTranscriptSocketAndExtensionFixturesDecode() throws {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let fallback = try decoder.decode(APIContractFallbackDiagnostic.self, from: Data(apiGoldenFallbackDiagnosticJSON.utf8))
        let transcript = try decoder.decode(APIContractTranscriptResponse.self, from: Data(apiGoldenTranscriptResponseJSON.utf8))
        let signal = try decoder.decode(APIContractGroupCallSignal.self, from: Data(apiGoldenGroupCallSignalJSON.utf8))
        let callSignal = try decoder.decode(APIContractCallSignal.self, from: Data(apiGoldenCallSignalJSON.utf8))
        let extensionMessage = try decoder.decode(APIContractExtensionMessage.self, from: Data(apiGoldenExtensionMessageJSON.utf8))

        XCTAssertEqual(fallback.correlationId, "contract-correlation-1")
        XCTAssertEqual(transcript.segments.first?.words.last?.offset, 450)
        XCTAssertEqual(signal.roomId, "22222222-2222-4222-8222-222222222222")
        XCTAssertEqual(callSignal.callId, "55555555-5555-4555-8555-555555555555")
        XCTAssertEqual(extensionMessage.tokens, ["hola", "mundo"])

        let missingDuration = apiGoldenTranscriptResponseJSON.replacingOccurrences(of: "\"duration\":900,", with: "")
        XCTAssertThrowsError(try decoder.decode(APIContractTranscriptResponse.self, from: Data(missingDuration.utf8)))
    }

    func testCanonicalTranscriptAndTokenizationFixtures() {
        for fixture in GeneratedTranscriptFixtures.contract.tokenization {
            let actual = tokenize(fixture.input)
            XCTAssertEqual(actual.map(\.text), fixture.tokens.map(\.text), fixture.name)
            XCTAssertEqual(actual.map(\.isWord), fixture.tokens.map(\.isWord), fixture.name)
            XCTAssertEqual(actual.map(\.text).joined(), fixture.input, fixture.name)
        }

        for fixture in GeneratedTranscriptFixtures.contract.srt {
            let actual = SRTParser.parse(fixture.input)
            XCTAssertEqual(actual.map(\.text), fixture.segments.map(\.text), fixture.name)
            XCTAssertEqual(actual.map(\.offset), fixture.segments.map(\.offset), fixture.name)
            XCTAssertEqual(actual.map(\.duration), fixture.segments.map(\.duration), fixture.name)
        }
    }

    private func makeSRSCard(
        id: String = "card-1",
        word: String = "supo",
        lemma: String? = nil,
        srsInterval: Int = 0,
        lastReviewedAt: String? = nil,
        learningStep: Int? = nil,
        introducedDate: String? = nil,
        relearningDate: String? = nil,
        dueAt: String? = nil,
        example: String? = "Ella ~supo~ la verdad.",
        sentence: String? = "She ~found out~ the truth.",
        stageSentences: [StageSentence]? = nil
    ) -> SavedWord {
        SavedWord(
            id: id,
            word: word,
            translation: "found out",
            definition: "",
            targetLanguage: "es",
            sentenceContext: nil,
            createdAt: "2026-06-01T12:00:00Z",
            frequency: nil,
            frequencyCount: nil,
            exampleSentence: example,
            sentenceTranslation: sentence,
            partOfSpeech: nil,
            srsInterval: srsInterval,
            dueAt: dueAt,
            lastReviewedAt: lastReviewedAt,
            correctCount: 0,
            incorrectCount: 0,
            easeFactor: 2.5,
            learningStep: learningStep,
            promptStage: 0,
            imageUrl: nil,
            lemma: lemma,
            forms: nil,
            priority: false,
            imageTerm: nil,
            queuePosition: nil,
            introducedDate: introducedDate,
            relearningDate: relearningDate,
            stageSentences: stageSentences
        )
    }

    private func localTestDateKey(_ date: Date = .now) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    // MARK: - Stage 4+ ladder tests

    func testCurrentExampleUsesBaseColumnsForStages0Through3() {
        let card = makeSRSCard(
            word: "supo",
            example: "Ella ~supo~ la verdad.",
            sentence: "She ~found out~ the truth."
        )

        for stage in 0...3 {
            let stageCard = card.withPromptStage(stage)
            let pair = currentExample(for: stageCard)
            XCTAssertEqual(pair?.example, "Ella ~supo~ la verdad.", "stage \(stage) example")
            XCTAssertEqual(pair?.translation, "She ~found out~ the truth.", "stage \(stage) translation")
        }
    }

    func testCurrentExampleReturnsNilWhenBaseColumnsMissing() {
        var card = makeSRSCard(
            word: "ser",
            example: nil,
            sentence: nil
        )
        card = card.withPromptStage(3)
        XCTAssertNil(currentExample(for: card))
    }

    func testCurrentExamplePicksMatchingEntryForStage4() {
        let card = makeSRSCard(
            word: "ser",
            example: "Él ~es~ muy alto.",
            sentence: "He ~is~ very tall.",
            stageSentences: [
                StageSentence(stage: 3, example: "Él ~es~ muy alto.", translation: "He ~is~ very tall."),
                StageSentence(stage: 4, example: "Ellos ~son~ intelligentes.", translation: "They ~are~ intelligent."),
            ]
        ).withPromptStage(4)

        let pair = currentExample(for: card)
        XCTAssertEqual(pair?.example, "Ellos ~son~ intelligentes.")
        XCTAssertEqual(pair?.translation, "They ~are~ intelligent.")
    }

    func testCurrentExampleFallsBackToHighestAvailableWhenStageAheadMissing() {
        // The server may not have generated the stage-5 sentence yet, but the
        // user has just advanced to stage 5. The card should still show the
        // most recently produced pair (stage 4 in this case) rather than
        // rendering as if there were no sentence at all.
        let card = makeSRSCard(
            word: "ser",
            example: "Él ~es~ muy alto.",
            sentence: "He ~is~ very tall.",
            stageSentences: [
                StageSentence(stage: 3, example: "Él ~es~ muy alto.", translation: "He ~is~ very tall."),
                StageSentence(stage: 4, example: "Ellos ~son~ intelligentes.", translation: "They ~are~ intelligent."),
            ]
        ).withPromptStage(5)

        let pair = currentExample(for: card)
        XCTAssertEqual(pair?.example, "Ellos ~son~ intelligentes.")
        XCTAssertEqual(pair?.translation, "They ~are~ intelligent.")
    }

    func testCurrentExampleGoesBackToEarlierPairWhenStageDecreases() {
        // Simulates a user at stage 5 falling back to stage 4 — the pair for
        // stage 4 (which they saw before) should be returned, not the stage-5
        // pair or a new one.
        let card = makeSRSCard(
            word: "ser",
            example: "Él ~es~ muy alto.",
            sentence: "He ~is~ very tall.",
            stageSentences: [
                StageSentence(stage: 3, example: "Él ~es~ muy alto.", translation: "He ~is~ very tall."),
                StageSentence(stage: 4, example: "Ellos ~son~ intelligentes.", translation: "They ~are~ intelligent."),
                StageSentence(stage: 5, example: "Nosotros ~somos~ amigos.", translation: "We ~are~ friends."),
            ]
        ).withPromptStage(4)

        let pair = currentExample(for: card)
        XCTAssertEqual(pair?.example, "Ellos ~son~ intelligentes.")
    }

    func testNextPromptStageAdvancesPastThree() {
        let card = makeSRSCard(word: "ser").withPromptStage(3)
        XCTAssertEqual(nextPromptStage(card: card, answer: "good"), 4)
        XCTAssertEqual(nextPromptStage(card: card, answer: "again"), 2)
    }

    func testNextPromptStageClampsAtZeroFloor() {
        let card = makeSRSCard(word: "ser").withPromptStage(0)
        XCTAssertEqual(nextPromptStage(card: card, answer: "again"), 0)
    }

    func testNextPromptStageRespectsUpperSafetyCap() {
        let card = makeSRSCard(word: "ser").withPromptStage(maxPromptStage)
        XCTAssertEqual(nextPromptStage(card: card, answer: "good"), maxPromptStage)
    }

    func testGetPromptTypePromotesToSentenceProductionAtStage4() {
        let card = makeSRSCard(
            word: "ser",
            example: "Él ~es~ muy alto.",
            sentence: "He ~is~ very tall.",
            stageSentences: [
                StageSentence(stage: 3, example: "Él ~es~ muy alto.", translation: "He ~is~ very tall."),
                StageSentence(stage: 4, example: "Ellos ~son~ intelligentes.", translation: "They ~are~ intelligent."),
            ]
        ).withPromptStage(4)

        XCTAssertEqual(getPromptType(card: card), .sentenceProduction)
    }

    func testGetPromptTypeFallsBackToWordProductionWhenStage4SentenceMissing() {
        // Mirrors FLASHCARDS.md fallback: a stage 3+ card with no usable pair
        // shows the word-production layout instead of an empty card.
        var card = makeSRSCard(
            word: "ser",
            example: nil,
            sentence: nil
        )
        card = card.withPromptStage(4)
        XCTAssertEqual(getPromptType(card: card), .wordProduction)
    }

    func testAutomaticCaptionJSONPreservesWordOffsets() throws {
        let data = #"{"events":[{"tStartMs":240,"dDurationMs":5519,"segs":[{"utf8":"Nós"},{"utf8":" todos","tOffsetMs":359},{"utf8":" temos,","tOffsetMs":640}]}]}"#.data(using: .utf8)!

        let track = try parseTimedCaptionJSON3(data, kind: .automatic)

        XCTAssertEqual(track.kind, .automatic)
        XCTAssertEqual(track.cues.first?.text, "Nós todos temos,")
        XCTAssertEqual(track.cues.first?.words, [
            TimedCaptionWord(text: "Nós", offset: 0),
            TimedCaptionWord(text: " todos", offset: 359),
            TimedCaptionWord(text: " temos,", offset: 640),
        ])
    }

    func testAutomaticCaptionDisplayRevealsWordsProgressively() throws {
        let data = #"{"events":[{"tStartMs":1000,"dDurationMs":2000,"segs":[{"utf8":"um"},{"utf8":" poder","tOffsetMs":400},{"utf8":" oculto","tOffsetMs":900}]}]}"#.data(using: .utf8)!
        let track = try parseTimedCaptionJSON3(data, kind: .automatic)

        XCTAssertEqual(captionDisplay(track: track, timeMilliseconds: 1100)?.currentLine, "um")
        XCTAssertEqual(captionDisplay(track: track, timeMilliseconds: 1450)?.currentLine, "um poder")
        XCTAssertEqual(captionDisplay(track: track, timeMilliseconds: 1950)?.currentLine, "um poder oculto")
    }

    func testAutomaticCaptionDisplayCarriesPreviousCompletedLine() throws {
        let data = #"{"events":[{"tStartMs":0,"dDurationMs":2500,"segs":[{"utf8":"primeira linha"}]},{"tStartMs":2000,"dDurationMs":2000,"segs":[{"utf8":"segunda"},{"utf8":" linha","tOffsetMs":500}]}]}"#.data(using: .utf8)!
        let track = try parseTimedCaptionJSON3(data, kind: .automatic)
        let display = captionDisplay(track: track, timeMilliseconds: 2250)

        XCTAssertEqual(display?.previousLine, "primeira linha")
        XCTAssertEqual(display?.currentLine, "segunda")
    }

    func testHumanCaptionDisplaysCompleteCue() throws {
        let data = #"{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"Previous subtitle."}]},{"tStartMs":1000,"dDurationMs":1500,"segs":[{"utf8":"Complete human subtitle."}]}]}"#.data(using: .utf8)!
        let track = try parseTimedCaptionJSON3(data, kind: .human)

        XCTAssertEqual(track.cues.last?.words, [])
        XCTAssertEqual(captionDisplay(track: track, timeMilliseconds: 1001)?.previousLine, "Previous subtitle.")
        XCTAssertEqual(captionDisplay(track: track, timeMilliseconds: 1001)?.currentLine, "Complete human subtitle.")
        XCTAssertNil(captionDisplay(track: track, timeMilliseconds: 2500))
    }

    func testCaptionWordTokensKeepNaturalSpacingAndLookupWords() {
        let tokens = captionWordTokens("¿Por qué, Chihiro?")

        XCTAssertEqual(tokens.map(\.text), ["¿Por ", "qué, ", "Chihiro?"])
        XCTAssertEqual(tokens.map(\.word), ["Por", "qué", "Chihiro"])
    }

    func testPortraitCaptionTokensJoinCueBoundaryWithoutForcingANewLine() {
        let display = CaptionDisplay(
            previousLine: "como si",
            currentLine: "fuera una tarta para ver",
            sentence: "fuera una tarta para ver"
        )
        let tokens = portraitCaptionTokens(display)

        XCTAssertEqual(tokens.map(\.text).joined(), "como si fuera una tarta para ver")
    }

    func testRelatedContentContractPreservesChannelIdentity() throws {
        let data = #"{"channelName":"Ter","channelHandle":"Ter","channelID":"UCCNgRIfWQKZyPkNvHEzPh7Q","channelAvatarURL":"https://example.com/large.jpg","videos":[]}"#.data(using: .utf8)!
        let content = try JSONDecoder().decode(RelatedContent.self, from: data)

        XCTAssertEqual(content.channelName, "Ter")
        XCTAssertEqual(content.channelHandle, "Ter")
        XCTAssertEqual(content.channelID, "UCCNgRIfWQKZyPkNvHEzPh7Q")
        XCTAssertEqual(content.channelAvatarURL, "https://example.com/large.jpg")
    }

    func testWatchChannelUsesCanonicalCuratedHandle() {
        let channels = [
            ChannelSummary(
                name: "Ter",
                handle: "ter",
                channelId: "UCCNgRIfWQKZyPkNvHEzPh7Q",
                thumbnails: [],
                subscribed: nil
            ),
        ]

        let match = matchingChannel(in: channels, id: nil, handle: "@Ter", name: "TER")

        XCTAssertEqual(match?.handle, "ter")
    }

    func testCaptionParserSkipsWindowAndNewlineEvents() throws {
        let data = #"{"events":[{"tStartMs":0,"dDurationMs":5000},{"tStartMs":100,"dDurationMs":500,"segs":[{"utf8":"\n"}]},{"tStartMs":200,"dDurationMs":1000,"segs":[{"utf8":"real words"}]}]}"#.data(using: .utf8)!

        let track = try parseTimedCaptionJSON3(data, kind: .automatic)

        XCTAssertEqual(track.cues.map(\.text), ["real words"])
    }
}

private extension SavedWord {
    /// Returns a copy with a different `promptStage`. Saves test code from
    /// re-listing all 26 fields.
    func withPromptStage(_ stage: Int) -> SavedWord {
        SavedWord(
            id: id,
            word: word,
            translation: translation,
            definition: definition,
            targetLanguage: targetLanguage,
            sentenceContext: sentenceContext,
            createdAt: createdAt,
            frequency: frequency,
            frequencyCount: frequencyCount,
            exampleSentence: exampleSentence,
            sentenceTranslation: sentenceTranslation,
            partOfSpeech: partOfSpeech,
            srsInterval: srsInterval,
            dueAt: dueAt,
            lastReviewedAt: lastReviewedAt,
            correctCount: correctCount,
            incorrectCount: incorrectCount,
            easeFactor: easeFactor,
            learningStep: learningStep,
            promptStage: stage,
            imageUrl: imageUrl,
            lemma: lemma,
            forms: forms,
            priority: priority,
            imageTerm: imageTerm,
            queuePosition: queuePosition,
            introducedDate: introducedDate,
            relearningDate: relearningDate,
            stageSentences: stageSentences
        )
    }

    func withSRSContractState(_ state: SRSContractState) -> SavedWord {
        SavedWord(
            id: id,
            word: word,
            translation: translation,
            definition: definition,
            targetLanguage: targetLanguage,
            sentenceContext: sentenceContext,
            createdAt: createdAt,
            frequency: frequency,
            frequencyCount: frequencyCount,
            exampleSentence: exampleSentence,
            sentenceTranslation: sentenceTranslation,
            partOfSpeech: partOfSpeech,
            srsInterval: state.srsInterval,
            dueAt: dueAt,
            lastReviewedAt: lastReviewedAt,
            correctCount: correctCount,
            incorrectCount: incorrectCount,
            easeFactor: state.easeFactor,
            learningStep: state.learningStep,
            promptStage: state.promptStage,
            imageUrl: imageUrl,
            lemma: lemma,
            forms: forms,
            priority: priority,
            imageTerm: imageTerm,
            queuePosition: queuePosition,
            introducedDate: introducedDate,
            relearningDate: relearningDate,
            stageSentences: stageSentences
        )
    }
}
