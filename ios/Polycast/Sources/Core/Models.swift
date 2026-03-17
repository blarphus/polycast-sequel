import Foundation

struct AuthUser: Codable, Equatable {
    let id: String
    let username: String
    let displayName: String?
    let nativeLanguage: String?
    let targetLanguage: String?
    let dailyNewLimit: Int?
    let accountType: String
    let cefrLevel: String?
}

struct AuthResponse: Codable {
    let token: String
    let id: String
    let username: String
    let displayName: String?
    let nativeLanguage: String?
    let targetLanguage: String?
    let dailyNewLimit: Int?
    let accountType: String
    let cefrLevel: String?

    var user: AuthUser {
        AuthUser(
            id: id,
            username: username,
            displayName: displayName,
            nativeLanguage: nativeLanguage,
            targetLanguage: targetLanguage,
            dailyNewLimit: dailyNewLimit,
            accountType: accountType,
            cefrLevel: cefrLevel
        )
    }
}

struct StudentDashboard: Codable {
    let newToday: [SavedWord]
    let dueWords: [SavedWord]
    let pendingClasswork: PendingClasswork
}

struct PendingClasswork: Codable {
    let count: Int?
}

struct UpcomingClass: Codable, Identifiable {
    let id: String
    let title: String?
    let teacherName: String?
    let teacherId: String?
    let scheduledAt: String?
    let durationMinutes: Int?
    let time: String?
}

struct Classroom: Codable, Identifiable {
    let id: String
    let name: String
    let section: String?
    let targetLanguage: String?
    let nativeLanguage: String?
    let classCode: String?
    let teacherCount: Int?
    let studentCount: Int?
    let teacherNames: [String]?
    let nextClassTitle: String?
    let nextClassAt: String?
    let role: String?
}

struct NewsArticle: Codable, Identifiable {
    var id: String { link }
    let originalTitle: String
    let simplifiedTitle: String
    let difficulty: String?
    let source: String
    let link: String
    let image: String?
    let preview: String?
}

struct TrendingVideo: Codable, Identifiable {
    var id: String { youtubeId }
    let youtubeId: String
    let title: String
    let channel: String
    let thumbnail: String
    let durationSeconds: Int?
    let publishedAt: String?
    let hasCaptions: Bool?
}

struct ChannelSummary: Codable, Identifiable {
    var id: String { handle }
    let name: String
    let handle: String
    let channelId: String
    let thumbnails: [String]
}

struct ChannelDetail: Codable {
    struct ChannelInfo: Codable {
        let name: String
        let handle: String
    }

    let channel: ChannelInfo
    let videos: [TrendingVideo]
}

struct LessonSummary: Codable, Identifiable {
    let id: String
    let title: String
    let thumbnails: [String]
    let videoCount: Int
}

struct LessonDetail: Codable {
    struct LessonInfo: Codable {
        let id: String
        let title: String
    }

    let lesson: LessonInfo
    let videos: [TrendingVideo]
}

struct VideoDetail: Codable, Identifiable {
    let id: String
    let youtubeId: String
    let title: String
    let channel: String
    let language: String
    let durationSeconds: Int?
    let transcriptStatus: String
    let transcriptSource: String?
    let cefrLevel: String?
    let transcriptProgress: Int?
    let transcript: [TranscriptSegment]?
    let transcriptLastError: String?
    let transcriptError: String?
}

struct TranscriptSegment: Codable, Identifiable, Hashable {
    var id: String { "\(offset)-\(duration)-\(text)" }
    let text: String
    let offset: Int
    let duration: Int
}

struct LookupResponse: Codable {
    let word: String
    let targetWord: String
    let valid: Bool
    let translation: String
    let definition: String
    let partOfSpeech: String?
    let lemma: String?
    let isNative: Bool
    let definitionSource: String?
    let example: String?
    let exampleTranslation: String?
    let sentenceTranslation: String?
}

struct SavedWord: Codable, Identifiable, Hashable {
    let id: String
    let word: String
    let translation: String
    let definition: String
    let targetLanguage: String?
    let sentenceContext: String?
    let createdAt: String
    let frequency: Int?
    let frequencyCount: Int?
    let exampleSentence: String?
    let sentenceTranslation: String?
    let partOfSpeech: String?
    let srsInterval: Int
    let dueAt: String?
    let lastReviewedAt: String?
    let correctCount: Int
    let incorrectCount: Int
    let easeFactor: Double
    let learningStep: Int?
    let promptStage: Int?
    let imageUrl: String?
    let lemma: String?
    let forms: String?
    let priority: Bool
    let imageTerm: String?
    let queuePosition: Int?
}

struct SavedWordResponse: Codable {
    let created: Bool?
    let id: String
    let word: String
    let translation: String
    let definition: String
    let targetLanguage: String?
    let sentenceContext: String?
    let createdAt: String
    let frequency: Int?
    let frequencyCount: Int?
    let exampleSentence: String?
    let sentenceTranslation: String?
    let partOfSpeech: String?
    let srsInterval: Int
    let dueAt: String?
    let lastReviewedAt: String?
    let correctCount: Int
    let incorrectCount: Int
    let easeFactor: Double
    let learningStep: Int?
    let promptStage: Int?
    let imageUrl: String?
    let lemma: String?
    let forms: String?
    let priority: Bool
    let imageTerm: String?
    let queuePosition: Int?

    var value: SavedWord {
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
            promptStage: promptStage,
            imageUrl: imageUrl,
            lemma: lemma,
            forms: forms,
            priority: priority,
            imageTerm: imageTerm,
            queuePosition: queuePosition
        )
    }
}

struct OKResponse: Codable {
    let ok: Bool
}

struct QuizQuestion: Codable, Hashable {
    let type: String
    let prompt: String
    let expected: String
    let inputMode: String
    let distractors: [String]
    let hint: String
    let savedWordId: String?
}

struct QuizAnswerResult: Codable {
    let isCorrect: Bool
    let expectedAnswer: String
    let aiFeedback: String
}

struct QuizSessionEnvelope: Codable {
    let sessionId: String
}

struct QuizSessionResult: Codable {
    struct Answer: Codable, Hashable {
        let questionIndex: Int
        let questionType: String
        let prompt: String
        let expectedAnswer: String
        let userAnswer: String
        let isCorrect: Bool
        let aiFeedback: String
    }

    let sessionId: String
    let questionCount: Int
    let correctCount: Int
    let percentage: Int
    let answers: [Answer]
}

struct DrillSessionsEnvelope: Codable {
    let sessions: [DrillSession]
}

struct DrillSession: Codable, Identifiable, Hashable {
    let id: String
    let tenseKey: String
    let verbFilter: String
    let questionCount: Int
    let correctCount: Int
    let durationSeconds: Int
    let createdAt: String
}

// MARK: - Wiktionary Lookup

struct WiktExample: Codable, Hashable {
    let text: String?
    let translation: String?
}

struct WiktSense: Codable, Hashable, Identifiable {
    let gloss: String
    let pos: String?
    let tags: [String]?
    let example: WiktExample?

    var id: Int { hashValue }
}

struct WiktLookupResponse: Codable {
    let word: String
    let senses: [WiktSense]
}

struct EnrichResponse: Codable {
    let word: String
    let translation: String
    let definition: String
    let partOfSpeech: String?
    let frequency: Int?
    let frequencyCount: Int?
    let exampleSentence: String?
    let sentenceTranslation: String?
    let imageUrl: String?
    let lemma: String?
    let forms: String?
    let imageTerm: String?
}

// MARK: - Social / Messaging

struct Conversation: Codable, Identifiable {
    var id: String { friendId }
    let friendId: String
    let friendUsername: String
    let friendDisplayName: String?
    let online: Bool
    let lastMessageBody: String?
    let lastMessageAt: String?
    let lastMessageSenderId: String?
    let unreadCount: Int
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let senderId: String
    let receiverId: String
    let body: String
    let readAt: String?
    let createdAt: String
}

struct MessagesPage: Codable {
    let messages: [ChatMessage]
    let hasMore: Bool
}

struct Friend: Codable, Identifiable {
    let id: String
    let friendshipId: String
    let username: String
    let displayName: String?
    let online: Bool
}

struct FriendRequest: Codable, Identifiable {
    let id: String
    let requesterId: String
    let username: String
    let displayName: String?
    let createdAt: String
}

struct UserSearchResult: Codable, Identifiable {
    let id: String
    let username: String
    let displayName: String?
    let online: Bool?
}

// MARK: - Student Tracking

struct ClassroomStudent: Codable, Identifiable {
    let classroomId: String
    let id: String
    let username: String
    let displayName: String?
    let online: Bool
    let addedAt: String
}

struct StudentStats: Codable {
    let totalWords: Int
    let wordsLearned: Int
    let wordsDue: Int
    let wordsNew: Int
    let wordsInLearning: Int
    let wordsMastered: Int
    let daysActiveThisWeek: Int
    let totalReviews: Int
    let accuracy: Double?
    let lastReviewedAt: String?
    let streak: Int
}

struct DailyWord: Codable {
    let action: String
    let word: String
    let translation: String
}

struct DailyActivity: Codable {
    let day: String
    let reviews: Int
    let wordsAdded: Int
    let quizzes: Int
    let quizCorrect: Int
    let quizTotal: Int
    let drills: Int
    let voiceSessions: Int
    let words: [DailyWord]
}

struct StudentWord: Codable, Identifiable {
    let id: String
    let word: String
    let translation: String
    let partOfSpeech: String?
    let srsStage: String
}

struct StudentWordList: Codable, Identifiable {
    let id: String
    let title: String
    let wordCount: Int
    let completed: Bool
    let completedAt: String?
}

struct RecentSession: Codable, Identifiable {
    let type: String
    let sessionId: String
    let questionCount: Int
    let correctCount: Int
    let durationSeconds: Int?
    let detail: String?
    let doneAt: String

    var id: String { "\(type)-\(sessionId)" }

    enum CodingKeys: String, CodingKey {
        case type, questionCount, correctCount, durationSeconds, detail, doneAt
        case sessionId = "id"
    }
}

struct StudentDetailResponse: Codable {
    struct StudentInfo: Codable {
        let id: String
        let username: String
        let displayName: String?
        let createdAt: String
    }

    let student: StudentInfo
    let stats: StudentStats
    let activity: [DailyActivity]
    let recentSessions: [RecentSession]
    let wordLists: [StudentWordList]
    let words: [StudentWord]
}

// MARK: - Call Modes & Transcription

enum CallMode {
    case audio
    case video
}

struct TranscriptEntry: Identifiable {
    let id = UUID()
    let userId: String
    let displayName: String
    let text: String
    let lang: String
}

// MARK: - Video Calling

struct IceServer: Codable {
    let urls: IceServerURLs
    let username: String?
    let credential: String?

    enum IceServerURLs: Codable {
        case single(String)
        case multiple([String])

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let single = try? container.decode(String.self) {
                self = .single(single)
            } else {
                self = .multiple(try container.decode([String].self))
            }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .single(let url): try container.encode(url)
            case .multiple(let urls): try container.encode(urls)
            }
        }

        var allURLs: [String] {
            switch self {
            case .single(let url): return [url]
            case .multiple(let urls): return urls
            }
        }
    }
}

struct IceServerResponse: Codable {
    let iceServers: [IceServer]
}
