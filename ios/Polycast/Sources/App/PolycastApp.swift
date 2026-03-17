import SwiftUI

@main
struct PolycastApp: App {
    @StateObject private var session = SessionStore()
    @StateObject private var wordStore = WordStore()
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
                .environmentObject(callManager)
                .preferredColorScheme(appTheme.colorScheme)
        }
    }
}

private struct RootView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore
    @EnvironmentObject private var callManager: CallManager

    var body: some View {
        ZStack {
            Group {
                if session.isLoading {
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
        }
        .fullScreenCover(isPresented: $callManager.isCallViewPresented) {
            CallView(friendName: callManager.activeCallDisplayName.isEmpty ? "Call" : callManager.activeCallDisplayName)
                .environmentObject(callManager)
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
    }
}

private struct MainTabView: View {
    var body: some View {
        TabView {
            NavigationStack {
                HomeView()
            }
            .tabItem {
                Label("Home", systemImage: "house.fill")
            }

            NavigationStack {
                BrowseView()
            }
            .tabItem {
                Label("Browse", systemImage: "play.rectangle.fill")
            }

            // Removed from tab bar (not needed for iOS): Practice, Dictionary

            NavigationStack {
                ConversationsView()
            }
            .tabItem {
                Label("Social", systemImage: "bubble.left.and.bubble.right.fill")
            }

            NavigationStack {
                StudentsView()
            }
            .tabItem {
                Label("Students", systemImage: "person.3.fill")
            }

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape.fill")
            }
        }
    }
}
