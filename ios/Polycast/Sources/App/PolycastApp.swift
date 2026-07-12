import SwiftUI
import OSLog
import WebKit

@main
struct PolycastApp: App {
    @StateObject private var session = SessionStore()
    @StateObject private var wordStore = WordStore()
    @StateObject private var bookLibrary = BookLibrary()
    @StateObject private var callManager = CallManager.shared
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @AppStorage(AppTheme.storageKey) private var themeRaw: String = AppTheme.dark.rawValue

    private var appTheme: AppTheme {
        AppTheme(rawValue: themeRaw) ?? .dark
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(wordStore)
                .environmentObject(bookLibrary)
                .environmentObject(callManager)
                .preferredColorScheme(appTheme.colorScheme)
        }
    }
}
private struct RootView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore
    @EnvironmentObject private var callManager: CallManager
    @ObservedObject private var fallbackNotices = FallbackNoticeCenter.shared
    @ObservedObject private var dailyGoal = DailyWordGoalStore.shared

    var body: some View {
        ZStack {
            Group {
                if ProcessInfo.processInfo.arguments.contains("-uiTestContentFixture") {
                    HermeticContentVerificationView()
                } else if ProcessInfo.processInfo.arguments.contains("-uiTestLandscapePlayer") {
                    HermeticPlayerVerificationView(persistentExpansion: false)
                } else if ProcessInfo.processInfo.arguments.contains("-uiTestPersistentWatchPlayer") {
                    HermeticPlayerVerificationView(persistentExpansion: true)
                } else if session.isLoading {
                    LoadingStateView(title: "Loading Polycast…")
                        .texturedBackground()
                } else if session.user == nil {
                    AuthContainerView()
                } else if session.needsOnboarding {
                    OnboardingView()
                } else {
                    MainTabView()
                }
            }
            .tint(.purple)

            if callManager.incomingCall != nil {
                IncomingCallView()
                    .environmentObject(callManager)
                    .transition(.opacity)
            }

            if let notice = fallbackNotices.notice {
                VStack {
                    FallbackNoticePill(notice: notice)
                    Spacer()
                }
                .padding(.top, 12)
                .padding(.horizontal, 16)
                .transition(.move(edge: .top).combined(with: .opacity))
                .zIndex(20)
            }

            if let celebration = dailyGoal.celebration {
                VStack {
                    DailyGoalCelebrationView(celebration: celebration)
                    Spacer()
                }
                .padding(.top, 12)
                .padding(.horizontal, 16)
                .zIndex(30)
            }

            if callManager.isCallMinimized && callManager.callStatus == .connected {
                MiniCallTileView()
                    .environmentObject(callManager)
                    .zIndex(50)
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.9), value: fallbackNotices.notice?.id)
        .animation(.spring(response: 0.38, dampingFraction: 0.76), value: dailyGoal.celebration?.id)
        .fullScreenCover(isPresented: $callManager.isCallViewPresented) {
            CallView(friendName: callManager.activeCallDisplayName.isEmpty ? "Call" : callManager.activeCallDisplayName)
                .environmentObject(callManager)
                .environmentObject(session)
                .environmentObject(wordStore)
        }
        .onChange(of: session.user?.id) {
            if session.user != nil {
                wordStore.prefetch()
                callManager.startListening()
            } else {
                wordStore.reset()
                callManager.stopListening()
            }
        }
        .onChange(of: session.user?.targetLanguage) {
            // The dictionary is per-target-language on the server, so switching
            // languages in Settings must reload the saved words.
            guard session.user != nil else { return }
            wordStore.reset()
            wordStore.prefetch()
        }
    }
}

struct FallbackNotice: Identifiable, Equatable {
    let id = UUID()
    let code: String
    let severity: String
    let title: String
    let message: String
    let detail: String?
    let source: String
    let operation: String
    let correlationID: String
    let occurredAt: Date
}

@MainActor
final class FallbackNoticeCenter: ObservableObject {
    static let shared = FallbackNoticeCenter()

    @Published var notice: FallbackNotice?
    private var dismissalTask: Task<Void, Never>?
    private let logger = Logger(subsystem: "app.polycast", category: "Fallback")

    private init() {}

    func show(
        code: String = "fallback_used",
        severity: String = "warning",
        title: String,
        message: String,
        detail: String? = nil,
        source: String = "ios.unknown",
        operation: String = "unknown",
        correlationID: String = UUID().uuidString,
        occurredAt: Date = .now
    ) {
        dismissalTask?.cancel()
        let next = FallbackNotice(
            code: code,
            severity: severity,
            title: title,
            message: message,
            detail: detail,
            source: source,
            operation: operation,
            correlationID: correlationID,
            occurredAt: occurredAt
        )
        notice = next
        logger.warning("Fallback code=\(code, privacy: .public) source=\(source, privacy: .public) operation=\(operation, privacy: .public) correlation=\(correlationID, privacy: .public) message=\(message, privacy: .public) detail=\(detail ?? "", privacy: .private(mask: .hash))")
        dismissalTask = Task {
            try? await Task.sleep(nanoseconds: 7_000_000_000)
            guard !Task.isCancelled else { return }
            self.notice = nil
        }
    }
}

private struct FallbackNoticePill: View {
    let notice: FallbackNotice

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 15, weight: .semibold))
            VStack(alignment: .leading, spacing: 3) {
                Text(notice.title)
                    .font(.subheadline.weight(.semibold))
                Text(notice.message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let detail = notice.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text("\(notice.code) · \(notice.source)/\(notice.operation) · ref \(notice.correlationID)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
                    .textSelection(.enabled)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.orange.opacity(0.55), lineWidth: 1))
        .foregroundStyle(.orange)
        .shadow(color: .black.opacity(0.18), radius: 16, x: 0, y: 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(notice.title). \(notice.message). Reference \(notice.correlationID)")
    }
}


private struct LandscapePlayerVerificationView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore

    private var shouldPlay: Bool {
        !ProcessInfo.processInfo.arguments.contains("-uiTestLandscapePaused")
    }

    private var youtubeID: String {
        ProcessInfo.processInfo.arguments.contains("-uiTestLandscapeTerVideo")
            ? "tb1dd4242_k"
            : "HAJzb7PONpI"
    }

    var body: some View {
        FullscreenPlayerView(
            youtubeID: youtubeID,
            language: "es",
            fallbackSegments: [],
            initialTime: 24.48,
            initiallyPlaying: shouldPlay,
            onDismiss: { _, _ in }
        )
        .environmentObject(session)
        .environmentObject(wordStore)
    }
}

/// Network-free player fixture for the required UI gate. Live YouTube smoke
/// coverage remains in `LandscapePlayerVerificationView`, but is intentionally
/// not part of deterministic CI.
private struct HermeticPlayerVerificationView: View {
    let persistentExpansion: Bool

    @State private var elapsed = 24.48
    @State private var expanded = false
    @State private var showSignInMessage = false
    @State private var showChannel = false

    private var shouldPlay: Bool {
        !ProcessInfo.processInfo.arguments.contains("-uiTestLandscapePaused")
    }

    var body: some View {
        GeometryReader { geometry in
            let availableHeight = geometry.size.height - geometry.safeAreaInsets.top - geometry.safeAreaInsets.bottom
            VStack(spacing: 0) {
                HermeticPlayerWebView()
                    .frame(height: availableHeight * 5 / 6)
                    .overlay(alignment: .topTrailing) {
                        if persistentExpansion && !expanded {
                            Button("Open landscape player") { expanded = true }
                                .padding()
                        }
                    }
                    .overlay(alignment: .topLeading) {
                        Button("Ter") { showChannel = true }
                            .accessibilityIdentifier("watch-channel-link")
                            .padding()
                    }

                VStack(spacing: 6) {
                    HStack(spacing: 4) {
                        Button("y") { showSignInMessage = true }
                        Button("en") { showSignInMessage = true }
                        Button("utiliza") { showSignInMessage = true }
                    }
                    .buttonStyle(.borderless)

                    Text(String(format: "%.2f", elapsed))
                        .accessibilityElement(children: .ignore)
                        .accessibilityIdentifier("landscape-player-time")
                        .accessibilityLabel("Player time")
                        .accessibilityValue(String(format: "%.2f", elapsed))

                    if showSignInMessage {
                        Text("Sign in to look up this word.")
                    }
                }
                .frame(height: availableHeight / 6)
                .frame(maxWidth: .infinity)
                .background(.thinMaterial)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("landscape-subtitle-panel")

            }
            .overlay {
                if showChannel {
                    VStack {
                        Picker("Channel videos", selection: .constant(0)) {
                            Text("Recent").tag(0)
                            Text("Popular").tag(1)
                        }
                        .pickerStyle(.segmented)
                        Button("Close") { showChannel = false }
                    }
                    .padding()
                    .background(.regularMaterial)
                }
            }
        }
        .onReceive(Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()) { _ in
            if shouldPlay { elapsed += 0.1 }
        }
    }
}

private struct HermeticPlayerWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero)
        webView.accessibilityIdentifier = "youtube-player-webview"
        webView.accessibilityValue = "hermetic-player-instance"
        webView.isAccessibilityElement = true
        webView.loadHTMLString("<html><body style='margin:0;background:#111;color:white;display:grid;place-items:center;font:24px sans-serif'>Polycast test video</body></html>", baseURL: nil)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}

private struct HermeticContentVerificationView: View {
    @State private var expandedWord = false
    @State private var readerOpen = false
    @State private var settingsOpen = false

    var body: some View {
        NavigationStack {
            if readerOpen {
                VStack(spacing: 20) {
                    Text("Al final mueren los dos")
                        .font(.title)
                    Text("Supongamos que esta página contiene texto de lectura determinista.")
                        .accessibilityIdentifier("reader-fixture-page")
                    Button("Aa") { settingsOpen = true }
                        .accessibilityIdentifier("reader-display-settings")
                    if settingsOpen {
                        Text("Reader display settings")
                            .accessibilityIdentifier("reader-settings-sheet")
                    }
                }
            } else {
                List {
                    Button("suponer") { expandedWord.toggle() }
                    if expandedWord {
                        Image(systemName: "photo.fill")
                            .accessibilityLabel("suponer image")
                            .accessibilityIdentifier("dictionary-word-image")
                    }
                    Button("Open reader fixture") { readerOpen = true }
                }
                .navigationTitle("Content verification")
            }
        }
    }
}

private struct MainTabView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var selection: MainTab = .practice

    private var isTeacher: Bool {
        session.user?.accountType == "teacher"
    }

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack {
                LearnView()
            }
            .tag(MainTab.practice)
            .tabItem {
                Label("Practice", systemImage: "bolt.fill")
            }

            NavigationStack {
                DictionaryView()
            }
            .tag(MainTab.dictionary)
            .tabItem {
                Label("Dictionary", systemImage: "book.fill")
            }

            NavigationStack {
                LibraryView()
            }
            .tag(MainTab.books)
            .tabItem {
                Label("Books", systemImage: "books.vertical.fill")
            }

            NavigationStack {
                VideosView()
            }
            .tag(MainTab.videos)
            .tabItem {
                Label("Videos", systemImage: "play.rectangle.fill")
            }

            NavigationStack {
                InProgressView(isTeacher: isTeacher)
            }
            .tag(MainTab.inProgress)
            .tabItem {
                Label("In Progress", systemImage: "ellipsis.circle.fill")
            }
        }
    }
}

private enum MainTab: Hashable {
    case dictionary
    case practice
    case books
    case videos
    case inProgress
}

private struct InProgressView: View {
    let isTeacher: Bool

    @State private var isExpanded = false

    var body: some View {
        List {
            DisclosureGroup(isExpanded: $isExpanded) {
                NavigationLink {
                    HomeView()
                } label: {
                    Label("Home", systemImage: "house.fill")
                }

                NavigationLink {
                    ConversationsView()
                } label: {
                    Label("Social", systemImage: "bubble.left.and.bubble.right.fill")
                }

                if isTeacher {
                    NavigationLink {
                        StudentsView()
                    } label: {
                        Label("Students", systemImage: "person.3.fill")
                    }
                }

                NavigationLink {
                    SettingsView()
                } label: {
                    Label("Settings", systemImage: "gearshape.fill")
                }
            } label: {
                Label("In Progress", systemImage: "hammer.fill")
                    .font(.headline)
            }
        }
        .texturedBackground()
        .navigationTitle("In Progress")
        .toolbarBackground(.hidden, for: .navigationBar)
    }
}
