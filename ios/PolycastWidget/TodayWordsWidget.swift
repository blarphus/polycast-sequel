import SwiftUI
import WidgetKit

@main
struct PolycastWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWordsWidget()
    }
}
struct TodayWordsWidget: Widget {
    let kind = todayWordsWidgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayWordsProvider()) { entry in
            TodayWordsWidgetView(entry: entry)
        }
        .configurationDisplayName("Today's Words")
        .description("Preview and reveal the new words waiting in Polycast.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
