import AppIntents
import Foundation
import WidgetKit

struct PreviousTodayWordIntent: AppIntent {
    static let title: LocalizedStringResource = "Previous Word"
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        let start = TodayWordsWidgetTiming.now()
        let startedAt = Date()
        TodayWordsWidgetDebugSignal.post("page-previous-start")
        let totalWords = TodayWordsWidgetStore.snapshotWordCount()
        TodayWordsWidgetStore.pageWord(action: "previous", totalWords: totalWords, startedAt: startedAt)
        WidgetCenter.shared.reloadTimelines(ofKind: todayWordsWidgetKind)
        TodayWordsWidgetTiming.logPageIntent(action: "previous", start: start, totalWords: totalWords)
        TodayWordsWidgetDebugSignal.post("page-previous-intent-complete")
        return .result()
    }
}
struct NextTodayWordIntent: AppIntent {
    static let title: LocalizedStringResource = "Next Word"
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        let start = TodayWordsWidgetTiming.now()
        let startedAt = Date()
        TodayWordsWidgetDebugSignal.post("page-next-start")
        let totalWords = TodayWordsWidgetStore.snapshotWordCount()
        TodayWordsWidgetStore.pageWord(action: "next", totalWords: totalWords, startedAt: startedAt)
        WidgetCenter.shared.reloadTimelines(ofKind: todayWordsWidgetKind)
        TodayWordsWidgetTiming.logPageIntent(action: "next", start: start, totalWords: totalWords)
        TodayWordsWidgetDebugSignal.post("page-next-intent-complete")
        return .result()
    }
}
