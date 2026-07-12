import SwiftUI
import UIKit

// MARK: - Preference keys

/// UserDefaults keys for reader display settings, shared between ReaderView
/// and ReaderSettingsSheet (both read them via @AppStorage).
enum ReaderPrefKey {
    static let fontScale = "reader.fontScale"
    static let font = "reader.font"
    static let lineSpacing = "reader.lineSpacing"
    static let margin = "reader.margin"
    static let progressMode = "reader.progressMode"
}

// MARK: - Page themes

/// The reader follows the app-wide light/dark theme. Palettes are the web
/// reader's: warm paper in light mode, near-black in dark mode (epub.css
/// `[data-reader-theme]` values).
enum ReaderTheme: String, CaseIterable, Identifiable {
    case light, dark

    var id: String { rawValue }

    var background: Color {
        switch self {
        case .light: return Color(red: 0.969, green: 0.957, blue: 0.925) // #f7f4ec
        case .dark: return Color(red: 0.051, green: 0.051, blue: 0.059) // #0d0d0f
        }
    }

    /// Toolbars, sheets, and the scrubber panel.
    var chrome: Color {
        switch self {
        case .light: return Color(red: 0.945, green: 0.925, blue: 0.878) // #f1ece0
        case .dark: return Color(red: 0.086, green: 0.086, blue: 0.094) // #161618
        }
    }

    var text: Color {
        switch self {
        case .light: return Color(red: 0.196, green: 0.180, blue: 0.157) // #322e28
        case .dark: return Color(red: 0.804, green: 0.792, blue: 0.749) // #cdcabf
        }
    }

    var secondaryText: Color {
        switch self {
        case .light: return Color(red: 0.424, green: 0.396, blue: 0.353) // #6c655a
        case .dark: return Color(red: 0.565, green: 0.553, blue: 0.522) // #908d85
        }
    }

    var divider: Color {
        switch self {
        case .light: return Color(red: 0.894, green: 0.867, blue: 0.800) // #e4ddcc
        case .dark: return Color(red: 0.149, green: 0.149, blue: 0.169) // #26262b
        }
    }

    /// Web reader's saved-word highlight (epub.css --success-dim).
    var savedHighlight: Color {
        Color(red: 0.18, green: 0.8, blue: 0.443).opacity(self == .dark ? 0.26 : 0.18)
    }

    var isDark: Bool { self == .dark }
}

// MARK: - Fonts (mirrors the web reader's READER_FONTS)

struct ReaderFontChoice: Identifiable, Equatable {
    let id: String
    let label: String
    /// Bundled iOS font names; nil means the system (San Francisco) font.
    let regularName: String?
    let boldName: String?

    static let all: [ReaderFontChoice] = [
        ReaderFontChoice(id: "georgia", label: "Georgia", regularName: "Georgia", boldName: "Georgia-Bold"),
        ReaderFontChoice(id: "palatino", label: "Palatino", regularName: "Palatino-Roman", boldName: "Palatino-Bold"),
        ReaderFontChoice(id: "times", label: "Times", regularName: "TimesNewRomanPSMT", boldName: "TimesNewRomanPS-BoldMT"),
        ReaderFontChoice(id: "iowan", label: "Iowan", regularName: "IowanOldStyle-Roman", boldName: "IowanOldStyle-Bold"),
        ReaderFontChoice(id: "system", label: "San Francisco", regularName: nil, boldName: nil),
    ]

    static let defaultChoice = all[0]

    /// Stored ids that no longer match a known font resolve to the default (same
    /// validation the web reader applies to localStorage prefs).
    static func choice(for id: String) -> ReaderFontChoice {
        all.first { $0.id == id } ?? defaultChoice
    }

    func uiFont(size: CGFloat, bold: Bool = false) -> UIFont {
        guard let name = bold ? boldName : regularName else {
            return .systemFont(ofSize: size, weight: bold ? .semibold : .regular)
        }
        if let font = UIFont(name: name, size: size) { return font }
        PolycastLog.runtime.error("[Polycast] Reader font \"\(name)\" is unavailable; using the system font instead.")
        return .systemFont(ofSize: size, weight: bold ? .semibold : .regular)
    }
}

// MARK: - Layout options

enum ReaderLineSpacing: String, CaseIterable, Identifiable {
    case tight, normal, loose

    var id: String { rawValue }
    var label: String {
        switch self {
        case .tight: return "Tight"
        case .normal: return "Normal"
        case .loose: return "Loose"
        }
    }
    var value: CGFloat {
        switch self {
        case .tight: return 2
        case .normal: return 5
        case .loose: return 10
        }
    }
}

enum ReaderMargin: String, CaseIterable, Identifiable {
    case narrow, medium, wide

    var id: String { rawValue }
    var label: String {
        switch self {
        case .narrow: return "Narrow"
        case .medium: return "Medium"
        case .wide: return "Wide"
        }
    }
    var value: CGFloat {
        switch self {
        case .narrow: return 14
        case .medium: return 22
        case .wide: return 34
        }
    }
}

/// What the always-visible footer shows; tapping it cycles modes (Kindle behavior).
enum ReaderProgressMode: String, CaseIterable {
    case pageInBook, pageInChapter, percent, off

    var next: ReaderProgressMode {
        let all = ReaderProgressMode.allCases
        let index = all.firstIndex(of: self) ?? 0
        return all[(index + 1) % all.count]
    }
}

// MARK: - Aa display settings sheet

struct ReaderSettingsSheet: View {
    let theme: ReaderTheme

    @AppStorage(ReaderPrefKey.fontScale) private var fontScale: Double = 1.0
    @AppStorage(ReaderPrefKey.font) private var fontID: String = ReaderFontChoice.defaultChoice.id
    @AppStorage(ReaderPrefKey.lineSpacing) private var lineSpacingID: String = ReaderLineSpacing.normal.rawValue
    @AppStorage(ReaderPrefKey.margin) private var marginID: String = ReaderMargin.medium.rawValue

    @State private var brightness: Double = Double(UIScreen.main.brightness)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                brightnessRow
                section("Text Size") { sizeRow }
                section("Font") { fontRow }
                HStack(alignment: .top, spacing: 14) {
                    section("Line Spacing") {
                        optionPills(ReaderLineSpacing.allCases.map { ($0.rawValue, $0.label) }, selected: lineSpacingID) {
                            lineSpacingID = $0
                        }
                    }
                    section("Margins") {
                        optionPills(ReaderMargin.allCases.map { ($0.rawValue, $0.label) }, selected: marginID) {
                            marginID = $0
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(theme.chrome)
        .presentationDetents([.height(360)])
        .presentationDragIndicator(.visible)
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(theme.secondaryText)
            content()
        }
    }

    private var brightnessRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "sun.min")
                .foregroundStyle(theme.secondaryText)
            Slider(value: $brightness, in: 0...1) { _ in
                UIScreen.main.brightness = CGFloat(brightness)
            }
            .tint(.purple)
            .onChange(of: brightness) {
                UIScreen.main.brightness = CGFloat(brightness)
            }
            Image(systemName: "sun.max")
                .foregroundStyle(theme.secondaryText)
        }
    }

    /// Stepper buttons instead of a slider — each tap repaginates once, so
    /// there's no per-tick relayout lag.
    private var sizeRow: some View {
        HStack(spacing: 10) {
            sizeButton(label: "A\u{2212}", size: 15, enabled: fontScale > 0.7) {
                fontScale = max(0.7, ((fontScale - 0.1) * 100).rounded() / 100)
            }
            Text("\(Int((fontScale * 100).rounded()))%")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(theme.secondaryText)
                .frame(minWidth: 52)
            sizeButton(label: "A+", size: 21, enabled: fontScale < 1.6) {
                fontScale = min(1.6, ((fontScale + 0.1) * 100).rounded() / 100)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func sizeButton(label: String, size: CGFloat, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: size, weight: .medium, design: .serif))
                .foregroundStyle(enabled ? theme.text : theme.secondaryText.opacity(0.5))
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(theme.background)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(theme.divider, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private var fontRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(ReaderFontChoice.all) { choice in
                    Button {
                        fontID = choice.id
                    } label: {
                        VStack(spacing: 4) {
                            Text("Aa")
                                .font(Font(choice.uiFont(size: 24) as CTFont))
                            Text(choice.label)
                                .font(.caption2)
                        }
                        .foregroundStyle(choice.id == fontID ? theme.text : theme.secondaryText)
                        .frame(width: 86, height: 64)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(theme.background)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(
                                    choice.id == fontID ? Color.purple : theme.divider,
                                    lineWidth: choice.id == fontID ? 2 : 1
                                )
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func optionPills(
        _ options: [(id: String, label: String)],
        selected: String,
        choose: @escaping (String) -> Void
    ) -> some View {
        HStack(spacing: 6) {
            ForEach(options, id: \.id) { option in
                Button {
                    choose(option.id)
                } label: {
                    Text(option.label)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(option.id == selected ? theme.text : theme.secondaryText)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(option.id == selected ? theme.background : .clear)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(
                                    option.id == selected ? Color.purple : theme.divider,
                                    lineWidth: option.id == selected ? 1.5 : 1
                                )
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}
