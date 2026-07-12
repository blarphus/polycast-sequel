import SwiftUI
import WidgetKit

struct TodayWordsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayWordsEntry

    private var words: [TodayWordsWidgetWord] {
        entry.snapshot.words
    }

    private var selectedWord: TodayWordsWidgetWord? {
        guard !entry.snapshot.isAllDone, !words.isEmpty else { return nil }
        return words[safe: entry.state.selectedIndex % max(words.count, 1)]
    }

    private var contentPadding: CGFloat {
        switch family {
        case .systemSmall:
            return 13
        case .systemMedium:
            return 24
        default:
            return 20
        }
    }

    var body: some View {
        ZStack {
            if entry.snapshot.isAllDone {
                allDoneView
            } else if let selectedWord {
                wordView(selectedWord)
            } else if entry.snapshot.hasPracticeData {
                noNewWordsView
            } else {
                emptyView
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .transaction { transaction in
            transaction.disablesAnimations = true
            transaction.animation = nil
        }
        .containerBackground(for: .widget) {
            ZStack {
                Color(red: 0.20, green: 0.07, blue: 0.48)
                subtleBackdrop
            }
        }
    }

    private var subtleBackdrop: some View {
        LinearGradient(
            colors: [
                Color(red: 0.93, green: 0.18, blue: 0.92).opacity(0.86),
                Color(red: 0.38, green: 0.36, blue: 1.00).opacity(0.68),
                Color(red: 0.00, green: 0.75, blue: 0.88).opacity(0.50),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    @ViewBuilder
    private func wordView(_ word: TodayWordsWidgetWord) -> some View {
        switch family {
        case .systemSmall:
            smallWordView(word)
        case .systemMedium:
            mediumWordView(word)
        default:
            largeWordView(word)
        }
    }

    private func smallWordView(_ word: TodayWordsWidgetWord) -> some View {
        ZStack(alignment: .bottomLeading) {
            wordImage(word, cornerRadius: 0)
            LinearGradient(
                colors: [.black.opacity(0.08), .black.opacity(0.68)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: 6) {
                compactHeader
                Spacer(minLength: 0)
                Text(word.word)
                    .font(.title3.bold())
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
                partOfSpeechPill(word.partOfSpeech)
                Text(word.definition)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(2)
                    .minimumScaleFactor(0.74)

            }
            .padding(13)

                if words.count > 1 {
                    HStack {
                        previousEdgeButton()
                        Spacer(minLength: 0)
                        nextEdgeButton()
                    }
                    .padding(.horizontal, 6)
                }
        }
    }

    private func mediumWordView(_ word: TodayWordsWidgetWord) -> some View {
        GeometryReader { proxy in
            ZStack {
                if let image = localImage(filename: word.localCardFilename) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .clipped()
                } else {
                    mediumLayeredWordView(word, size: proxy.size)
                }

                if words.count > 1 {
                    HStack {
                        previousEdgeButton(height: proxy.size.height)
                        Spacer(minLength: 0)
                        nextEdgeButton(height: proxy.size.height)
                    }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
    }

    private func mediumLayeredWordView(_ word: TodayWordsWidgetWord, size: CGSize) -> some View {
        HStack(spacing: 0) {
            wordImage(word, cornerRadius: 0)
                .frame(width: size.width * 0.43, height: size.height)
                .clipped()

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 0) {
                    reviewCountLabel
                    Spacer(minLength: 0)
                }
                wordTitle(word, font: .title2.bold())
                partOfSpeechPill(
                    word.partOfSpeech,
                    font: .caption.weight(.heavy),
                    horizontalPadding: 10,
                    verticalPadding: 5
                )
                definitionBlock(
                    word,
                    definitionLines: 2,
                    definitionFont: .subheadline.weight(.bold),
                    minimumScaleFactor: 0.56
                )
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(width: size.width * 0.57, height: size.height, alignment: .leading)
            .background(Color(red: 0.07, green: 0.06, blue: 0.16))
        }
        .frame(width: size.width, height: size.height)
    }

    private func largeWordView(_ word: TodayWordsWidgetWord) -> some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 0) {
                wordImage(word, cornerRadius: 0)
                    .frame(height: proxy.size.height * 0.47)
                    .clipped()

                VStack(alignment: .leading, spacing: 9) {
                    wordTitle(word, font: .title.bold())
                    partOfSpeechPill(word.partOfSpeech)
                    definitionBlock(word, definitionLines: 3, definitionFont: .title3.weight(.bold))

                    if let example = cleaned(word.exampleSentence), !example.isEmpty {
                        Text(example)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.64))
                            .lineLimit(2)
                    }

                    Spacer(minLength: 0)

                    HStack(spacing: 12) {
                        previousEdgeButton()
                        Spacer()
                        reviewCountLabel
                        Spacer()
                        nextEdgeButton()
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .background(Color(red: 0.07, green: 0.06, blue: 0.16).opacity(0.94))
            }
        }
    }

    private var compactHeader: some View {
        HStack(spacing: 6) {
            brandMark
            Text("Polycast")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white.opacity(0.92))
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }

    private var brandMark: some View {
        Image(systemName: "p.square.fill")
            .font(.caption.weight(.bold))
            .foregroundStyle(.purple, .white)
    }

    private var reviewCountLabel: some View {
        let count = max(entry.snapshot.dueCount, entry.snapshot.reviewCount + entry.snapshot.newCount)
        return Text("\(count) \(count == 1 ? "card" : "cards") due today")
            .font(.caption2.weight(.heavy))
            .foregroundStyle(.white.opacity(0.82))
            .lineLimit(1)
            .minimumScaleFactor(0.74)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.white.opacity(0.10), in: Capsule())
    }

    private func wordTitle(_ word: TodayWordsWidgetWord, font: Font) -> some View {
        Text(word.word)
            .font(font)
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.62)
    }

    @ViewBuilder
    private func partOfSpeechPill(
        _ partOfSpeech: String?,
        font: Font = .caption2.weight(.heavy),
        horizontalPadding: CGFloat = 8,
        verticalPadding: CGFloat = 4
    ) -> some View {
        if let partOfSpeech, !partOfSpeech.isEmpty {
            Text(partOfSpeech.uppercased())
                .font(font)
                .foregroundStyle(.white)
                .lineLimit(1)
                .padding(.horizontal, horizontalPadding)
                .padding(.vertical, verticalPadding)
                .background(.purple.opacity(0.86), in: Capsule())
        }
    }

    private func definitionBlock(
        _ word: TodayWordsWidgetWord,
        definitionLines: Int,
        definitionFont: Font = .caption,
        minimumScaleFactor: CGFloat = 0.72
    ) -> some View {
        Text(word.definition)
            .font(definitionFont)
            .foregroundStyle(.white)
            .lineLimit(definitionLines)
            .minimumScaleFactor(minimumScaleFactor)
    }

    @ViewBuilder
    private func nextButton(iconOnly: Bool) -> some View {
        if words.count > 1 {
            Button(intent: NextTodayWordIntent()) {
                if iconOnly {
                    Label("Next", systemImage: "arrow.right")
                        .labelStyle(.iconOnly)
                        .frame(width: 44, height: 32)
                } else {
                    Label("Next", systemImage: "arrow.right")
                        .frame(height: 32)
                }
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, iconOnly ? 0 : 10)
            .background(.purple, in: Capsule())
            .buttonStyle(.plain)
        }
    }

    private var previousButton: some View {
        Button(intent: PreviousTodayWordIntent()) {
            Label("Previous", systemImage: "arrow.left")
                .labelStyle(.iconOnly)
                .frame(width: 36, height: 32)
        }
        .font(.caption.weight(.bold))
        .foregroundStyle(.white)
        .background(.white.opacity(0.14), in: Capsule())
        .buttonStyle(.plain)
        .disabled(words.count < 2)
    }

    private func previousEdgeButton(height: CGFloat = 48) -> some View {
        Button(intent: PreviousTodayWordIntent()) {
            Image(systemName: "chevron.left")
                .font(.title3.weight(.semibold))
                .frame(width: 64, height: height)
                .contentShape(Rectangle())
        }
        .foregroundStyle(.white.opacity(0.88))
        .buttonStyle(.plain)
        .buttonRepeatBehavior(.enabled)
        .disabled(words.count < 2)
    }

    private func nextEdgeButton(height: CGFloat = 48) -> some View {
        Button(intent: NextTodayWordIntent()) {
            Image(systemName: "chevron.right")
                .font(.title3.weight(.semibold))
                .frame(width: 64, height: height)
                .contentShape(Rectangle())
        }
        .foregroundStyle(.white.opacity(0.88))
        .buttonStyle(.plain)
        .buttonRepeatBehavior(.enabled)
        .disabled(words.count < 2)
    }

    private func pageDots(dotSize: CGFloat = 6, spacing: CGFloat = 6) -> some View {
        HStack(spacing: spacing) {
            ForEach(0..<min(words.count, 5), id: \.self) { index in
                Circle()
                    .fill(dotIsSelected(index) ? Color.purple : Color.white.opacity(0.34))
                    .frame(width: dotSize, height: dotSize)
            }
        }
        .opacity(words.count > 1 ? 1 : 0)
    }

    private func dotIsSelected(_ index: Int) -> Bool {
        (entry.state.selectedIndex % max(min(words.count, 5), 1)) == index
    }

    @ViewBuilder
    private func wordImage(_ word: TodayWordsWidgetWord, cornerRadius: CGFloat) -> some View {
        if let image = localImage(for: word) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        } else {
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.34, green: 0.30, blue: 0.92),
                        Color(red: 0.09, green: 0.08, blue: 0.20),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Image(systemName: "photo")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.56))
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        }
    }

    private func localImage(for word: TodayWordsWidgetWord) -> UIImage? {
        if let image = localImage(filename: word.localImageFilename) {
            return image
        }
        guard let imageUrl = APIImageURLString(word.imageUrl),
              let data = TodayWordsWidgetImageStore.sharedImageData(for: word.id, imageURL: imageUrl)
        else {
            return nil
        }
        TodayWordsWidgetDebugSignal.post("shared-image-rendered")
        return UIImage(data: data)
    }

    private func localImage(filename: String?) -> UIImage? {
        guard let url = TodayWordsWidgetImageStore.imageURL(for: filename) else {
            return nil
        }
        return UIImage(contentsOfFile: url.path)
    }

    private func APIImageURLString(_ urlString: String?) -> String? {
        TodayWordsWidgetAPIClient.renderableImageURLString(urlString)
    }

    private var allDoneView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "checkmark.seal.fill")
                .font(.title2.bold())
                .foregroundStyle(.green)
            Text("All done for today")
                .font(.title2.bold())
                .foregroundStyle(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.78)
            Text("You cleared today's practice.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(2)
            Spacer(minLength: 0)
            Link(destination: URL(string: "polycast://practice")!) {
                Label("Open Polycast", systemImage: "arrow.up.right")
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(contentPadding)
    }

    private var noNewWordsView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "bolt.fill")
                .font(.title2.bold())
                .foregroundStyle(.purple)
            Text(entry.snapshot.reviewCount > 0 ? "Reviews ready" : "No new words")
                .font(.title2.bold())
                .foregroundStyle(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.78)
            Text(entry.snapshot.reviewCount > 0 ? "\(entry.snapshot.reviewCount) cards are waiting in practice." : "Your new-word queue is clear for today.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(3)
            Spacer(minLength: 0)
            Link(destination: URL(string: "polycast://practice")!) {
                Label("Open Practice", systemImage: "arrow.up.right")
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.borderedProminent)
            .tint(.purple)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(contentPadding)
    }

    private var emptyView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Polycast")
                .font(.headline.bold())
                .foregroundStyle(.white)
            Text("Open practice once to load today's words.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(3)
            Spacer(minLength: 0)
            Link(destination: URL(string: "polycast://practice")!) {
                Label("Open", systemImage: "arrow.up.right")
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.borderedProminent)
            .tint(.purple)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(contentPadding)
    }

    private func cleaned(_ text: String?) -> String? {
        text?.replacingOccurrences(of: "~", with: "")
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else { return nil }
        return self[index]
    }
}

#Preview(as: .systemMedium) {
    TodayWordsWidget()
} timeline: {
    TodayWordsEntry(date: .now, snapshot: .sample, state: .empty)
    TodayWordsEntry(date: .now, snapshot: .sample, state: TodayWordsWidgetState(selectedIndex: 1, isRevealed: true, navigationDirection: 1))
    TodayWordsEntry(date: .now, snapshot: .empty, state: .empty)
}
