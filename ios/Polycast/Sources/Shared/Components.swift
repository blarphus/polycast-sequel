import SwiftUI

// MARK: - Background Texture

enum BackgroundTexture: String, CaseIterable {
    case none = "None"
    case dots = "Dots"
    case grid = "Grid"

    static let storageKey = "polycast.bgTexture"
}

enum AppTheme: String, CaseIterable {
    case dark = "Dark"
    case light = "Light"
    case system = "System"

    static let storageKey = "polycast.theme"

    var colorScheme: ColorScheme? {
        switch self {
        case .dark: return .dark
        case .light: return .light
        case .system: return nil
        }
    }
}

struct DotBackgroundView: View {
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(BackgroundTexture.storageKey) private var textureRaw: String = BackgroundTexture.dots.rawValue

    private var texture: BackgroundTexture {
        BackgroundTexture(rawValue: textureRaw) ?? .dots
    }

    var body: some View {
        switch texture {
        case .none:
            Color.clear
        case .dots:
            Canvas { context, size in
                let spacing: CGFloat = 24
                let dotRadius: CGFloat = 1.4
                let color = colorScheme == .dark
                    ? Color(red: 0.42, green: 0.39, blue: 1.0).opacity(0.4)
                    : Color(red: 0.42, green: 0.39, blue: 1.0).opacity(0.25)

                for x in stride(from: CGFloat(0), through: size.width, by: spacing) {
                    for y in stride(from: CGFloat(0), through: size.height, by: spacing) {
                        let rect = CGRect(x: x - dotRadius, y: y - dotRadius, width: dotRadius * 2, height: dotRadius * 2)
                        context.fill(Path(ellipseIn: rect), with: .color(color))
                    }
                }
            }
            .ignoresSafeArea()
        case .grid:
            Canvas { context, size in
                let spacing: CGFloat = 24
                let lineWidth: CGFloat = 0.5
                let color = colorScheme == .dark
                    ? Color(red: 0.42, green: 0.39, blue: 1.0).opacity(0.3)
                    : Color.black.opacity(0.08)

                for x in stride(from: CGFloat(0), through: size.width, by: spacing) {
                    var path = Path()
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: size.height))
                    context.stroke(path, with: .color(color), lineWidth: lineWidth)
                }
                for y in stride(from: CGFloat(0), through: size.height, by: spacing) {
                    var path = Path()
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: size.width, y: y))
                    context.stroke(path, with: .color(color), lineWidth: lineWidth)
                }
            }
            .ignoresSafeArea()
        }
    }
}

// MARK: - Textured Background Modifier

extension View {
    func texturedBackground() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background {
                ZStack {
                    Color(.systemBackground)
                    DotBackgroundView()
                }
                .ignoresSafeArea()
            }
    }
}

struct LoadingStateView: View {
    let title: String

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .progressViewStyle(.circular)
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

struct EmptyStateView: View {
    let title: String
    let subtitle: String?

    var body: some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.headline)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
    }
}

struct SectionHeader: View {
    let title: String
    let subtitle: String?

    init(_ title: String, subtitle: String? = nil) {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.title3.weight(.semibold))
            if let subtitle {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct Chip: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }
}

struct FrequencyDotsView: View {
    let frequency: Int?

    private static let colors: [Color] = [
        Color(red: 1, green: 0.3, blue: 0.3),
        Color(red: 1, green: 0.58, blue: 0.3),
        Color(red: 1, green: 0.87, blue: 0.3),
        Color(red: 0.46, green: 0.82, blue: 0.28),
        Color(red: 0.29, green: 0.87, blue: 0.5),
    ]

    var body: some View {
        if let frequency {
            let filled = max(1, Int(ceil(Double(frequency) / 2.0)))
            let color = Self.colors[min(filled - 1, Self.colors.count - 1)]
            HStack(spacing: 2) {
                ForEach(0..<5, id: \.self) { i in
                    Circle()
                        .fill(color.opacity(i < filled ? 1 : 0.25))
                        .frame(width: 6, height: 6)
                }
            }
        }
    }
}

struct WordFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX && x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }

            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
