import SwiftUI

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
                if ProcessInfo.processInfo.arguments.contains("-uiTestLandscapePlayer") {
                    LandscapePlayerVerificationView()
                } else if ProcessInfo.processInfo.arguments.contains("-uiTestPersistentWatchPlayer") {
                    PersistentWatchPlayerVerificationView()
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
    let title: String
    let message: String
}

@MainActor
final class FallbackNoticeCenter: ObservableObject {
    static let shared = FallbackNoticeCenter()

    @Published var notice: FallbackNotice?
    private var dismissalTask: Task<Void, Never>?

    private init() {}

    func show(title: String, message: String) {
        dismissalTask?.cancel()
        notice = FallbackNotice(title: title, message: message)
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
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 15, weight: .semibold))
            Text(notice.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Text(notice.message)
                .font(.subheadline)
                .lineLimit(1)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().stroke(Color.orange.opacity(0.55), lineWidth: 1))
        .foregroundStyle(.orange)
        .shadow(color: .black.opacity(0.18), radius: 16, x: 0, y: 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(notice.title). \(notice.message)")
    }
}

private struct PersistentWatchPlayerVerificationView: View {
    private let video = VideoDetail(
        id: "ui-test-watch-video",
        youtubeId: "tb1dd4242_k",
        title: "La arquitectura de El Viaje de Chihiro",
        channel: "Ter",
        language: "es",
        durationSeconds: nil,
        transcriptStatus: "ready",
        transcriptSource: "youtube_auto",
        cefrLevel: nil,
        transcriptProgress: nil,
        transcript: [
            TranscriptSegment(
                text: "y se utiliza para denunciar que existe un poder oculto entre",
                offset: 24_000,
                duration: 8_000
            )
        ],
        transcriptLastError: nil,
        transcriptError: nil
    )

    var body: some View {
        NavigationStack {
            WatchView(
                videoID: video.id,
                initialVideo: video,
                initialTime: 24.48,
                playAfterInitialSeek: true
            )
        }
        .onAppear {
            OrientationController.leaveLandscape()
        }
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
