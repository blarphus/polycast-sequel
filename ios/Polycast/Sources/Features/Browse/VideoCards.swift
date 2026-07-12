import SwiftUI

struct ChannelCard: View {
    let channel: ChannelSummary

    var body: some View {
        VStack(alignment: .center, spacing: 9) {
            AsyncImage(url: URL(string: channel.thumbnails.first ?? "")) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ZStack {
                    Circle().fill(.white.opacity(0.08))
                    Image(systemName: "person.crop.circle.fill").font(.system(size: 34)).foregroundStyle(.secondary)
                }
            }
            .frame(width: 96, height: 96)
            .clipShape(Circle())
            Text(channel.name).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }
}

struct SearchChannelCard: View {
    let channel: ChannelSummary

    var body: some View {
        VStack(alignment: .center, spacing: 9) {
            AsyncImage(url: URL(string: channel.thumbnails.first ?? "")) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ZStack {
                    Circle().fill(.white.opacity(0.08))
                    Image(systemName: "person.crop.circle.fill").font(.system(size: 34)).foregroundStyle(.secondary)
                }
            }
            .frame(width: 92, height: 92)
            .clipShape(Circle())
            Text(channel.name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(2).multilineTextAlignment(.center)
            Text(channel.handle.hasPrefix("UC") ? "Channel" : "@\(channel.handle)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }
}

struct CompactVideoCard: View {
    let video: TrendingVideo
    let showsChannel: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            GeometryReader { proxy in
                ZStack(alignment: .bottomTrailing) {
                    AsyncImage(url: URL(string: video.thumbnail)) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Rectangle().fill(.white.opacity(0.08))
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .clipped()
                    PlaybackProgressBar(fraction: VideoProgressStore.progressFraction(forYoutubeID: video.youtubeId, durationSeconds: video.durationSeconds))
                    if let duration = video.durationSeconds {
                        Text(formatDuration(duration)).font(.caption2.weight(.semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 5).padding(.vertical, 3)
                            .background(.black.opacity(0.82), in: RoundedRectangle(cornerRadius: 4)).padding(5)
                    }
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipped()
            Text(video.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(2).multilineTextAlignment(.leading)
            if showsChannel { Text(video.channel).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            if let metadata = metadataText { Text(metadata).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let remainingSeconds = seconds % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, remainingSeconds) : String(format: "%d:%02d", minutes, remainingSeconds)
    }

    private var metadataText: String? {
        var parts: [String] = []
        if let viewCount = video.viewCount { parts.append("\(formatViewCount(viewCount)) views") }
        if let published = formatPublishedDate(video.publishedAt) { parts.append(published) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func formatViewCount(_ count: Int) -> String {
        let value = Double(count)
        switch count {
        case 1_000_000_000...: return String(format: "%.1fB", value / 1_000_000_000).replacingOccurrences(of: ".0", with: "")
        case 1_000_000...: return String(format: "%.1fM", value / 1_000_000).replacingOccurrences(of: ".0", with: "")
        case 1_000...: return String(format: "%.1fK", value / 1_000).replacingOccurrences(of: ".0", with: "")
        default: return NumberFormatter.localizedString(from: NSNumber(value: count), number: .decimal)
        }
    }

    private func formatPublishedDate(_ value: String?) -> String? {
        guard let value, let date = ISO8601DateFormatter().date(from: value) else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct PlaybackProgressBar: View {
    let fraction: Double?

    var body: some View {
        GeometryReader { geometry in
            if let fraction, fraction > 0 {
                VStack {
                    Spacer(minLength: 0)
                    HStack(spacing: 0) {
                        Rectangle().fill(Color.red).frame(width: max(2, geometry.size.width * min(max(fraction, 0), 1)))
                        Spacer(minLength: 0)
                    }
                    .frame(height: 4)
                    .background(Color.black.opacity(0.18))
                }
            }
        }
        .allowsHitTesting(false)
    }
}
