import SwiftUI
import WidgetKit

struct PracticeStartSnapshot {
    let overview: StudyOverview
    let previewWords: [SavedWord]
    let newWordsCount: Int
    let savedAt: Date
}
@MainActor
enum PracticeStartCache {
    static let ttl: TimeInterval = 300
    static var snapshot: PracticeStartSnapshot?

    static var freshSnapshot: PracticeStartSnapshot? {
        guard let snapshot, Date().timeIntervalSince(snapshot.savedAt) < ttl else {
            return nil
        }
        return snapshot
    }
}

struct LearnView: View {
    @Environment(\.dismiss) var dismiss
    @Environment(\.colorScheme) var colorScheme

    @State var cards: [SavedWord] = []
    @State var currentIndex = 0
    @State var isFlipped = false
    @State var isExiting = false
    @State var exitDirection: Edge = .trailing
    @State var isEntering = false
    @State var loading = true
    @State var submitting = false
    @State var error = ""
    @State var feedback: (answer: String, text: String)?
    @State var sessionStats = (reviewed: 0, correct: 0, incorrect: 0)
    @State var sessionStart = Date()
    @State var dragOffset: CGSize = .zero
    @State var audioPlayedForSide: Set<String> = []
    @AppStorage("flashcardAudioMuted") var audioMuted = false
    @State var showingCardInfo = false
    @State var editingCard: SavedWord?
    @State var checkingForMore = false
    @State var loadingRemainingSession = false

    @EnvironmentObject var session: SessionStore
    @EnvironmentObject var wordStore: WordStore
    @Environment(\.scenePhase) var scenePhase
    @ObservedObject var handsFreeController = HandsFreeController.shared
    @State var selectedLookup: LookupContext?
    @State var started = false
    @State var overview: StudyOverview?
    @State var previewWords: [SavedWord] = []
    @State var loadingOverview = true
    @State var startingSession = false
    @State var newWordsCount = 0
    @State var carouselScrollID: String?
    @State var sessionNewWordLimit = 0
    @State var completionOverview: StudyOverview?
    @State var loadingCompletionOptions = false
    @State var additionalNewWords = 1
    @State var addingMoreWords = false
    @State var handsFree = false
    // Volume buttons are pinned in hands-free; this slider sets the pin level so
    // the learner can still change the actual loudness.
    @AppStorage("handsFreeVolume") var handsFreeVolume: Double = 0.5
    let initialSessionCardLimit = 5

    var body: some View {
        ZStack {
            if !started {
                introView
            } else if loading {
                LoadingStateView(title: "Loading flashcards...")
            } else if cards.isEmpty {
                sessionCompleteView
            } else if currentIndex >= cards.count {
                if checkingForMore || loadingRemainingSession {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text(loadingRemainingSession ? "Loading more cards..." : "Checking for more cards...")
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
                        PracticeStartCache.snapshot = nil
                        Task {
                            do {
                                try await APIClient.shared.deleteWord(id: id)
                                WidgetCenter.shared.reloadAllTimelines()
                            } catch {
                                PolycastLog.runtime.error("[Polycast] Failed to delete word: \(error)")
                            }
                        }
                    }
                )
            }
        }
        .task {
            guard overview == nil else { return }
            if !restoreCachedOverview() {
                await loadOverview()
            }
        }
        .onChange(of: scenePhase) {
            // Re-fetch when the app returns to the foreground so a session
            // finished on another device is reflected here (cross-device sync).
            // Only refresh the start screen — never disrupt an in-progress session.
            guard scenePhase == .active, !started, !loadingOverview else { return }
            if !restoreCachedOverview() {
                Task { await loadOverview(force: true) }
            }
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

    var maxNewWords: Int { min(overview?.newAvailable ?? 0, 50) }
    var selectedPreviewWords: [SavedWord] { Array(previewWords.prefix(newWordsCount)) }

}
