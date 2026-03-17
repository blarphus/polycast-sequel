import SwiftUI
import Combine

struct ConversationsView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var conversations: [Conversation] = []
    @State private var pendingCount = 0
    @State private var loading = true
    @State private var error = ""
    @State private var showSearch = false
    @State private var showRequests = false
    @State private var timer: Publishers.Autoconnect<Timer.TimerPublisher>?

    private let api = APIClient.shared

    var body: some View {
        Group {
            if loading && conversations.isEmpty {
                LoadingStateView(title: "Loading conversations...")
                    .frame(maxHeight: .infinity)
            } else if conversations.isEmpty {
                emptyState
            } else {
                conversationList
            }
        }
        .texturedBackground()
        .navigationTitle("Social")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 16) {
                    Button { showRequests = true } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "person.badge.clock")
                            if pendingCount > 0 {
                                Text("\(pendingCount)")
                                    .font(.caption2).bold()
                                    .foregroundStyle(.white)
                                    .padding(4)
                                    .background(Color.purple, in: Circle())
                                    .offset(x: 8, y: -8)
                            }
                        }
                    }
                    Button { showSearch = true } label: {
                        Image(systemName: "magnifyingglass")
                    }
                }
            }
        }
        .sheet(isPresented: $showSearch) {
            UserSearchSheet()
        }
        .sheet(isPresented: $showRequests) {
            FriendRequestsSheet {
                Task { await load() }
            }
        }
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
        .onReceive(Timer.publish(every: 15, on: .main, in: .common).autoconnect()) { _ in
            Task { await load() }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No conversations yet")
                .font(.headline)
            Text("Search for friends to start chatting")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var conversationList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(conversations) { convo in
                    NavigationLink {
                        ChatView(
                            friendId: convo.friendId,
                            friendName: convo.friendDisplayName ?? convo.friendUsername
                        )
                    } label: {
                        conversationRow(convo)
                    }
                    .buttonStyle(.plain)

                    Divider()
                        .padding(.leading, 68)
                }
            }
        }
    }

    private func conversationRow(_ convo: Conversation) -> some View {
        HStack(spacing: 12) {
            // Avatar with online dot
            ZStack(alignment: .bottomTrailing) {
                initialsCircle(convo.friendDisplayName ?? convo.friendUsername)
                if convo.online {
                    Circle()
                        .fill(.green)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(convo.friendDisplayName ?? convo.friendUsername)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer()
                    Text(formatRelativeTime(convo.lastMessageAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                HStack {
                    if let body = convo.lastMessageBody {
                        let prefix = convo.lastMessageSenderId == session.user?.id ? "You: " : ""
                        Text("\(prefix)\(body)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    if convo.unreadCount > 0 {
                        Text("\(convo.unreadCount)")
                            .font(.caption2).bold()
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.purple, in: Capsule())
                    }
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private func initialsCircle(_ name: String) -> some View {
        let initials = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
        let display = initials.isEmpty ? String(name.prefix(1)).uppercased() : initials.uppercased()
        return Text(display)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .background(Color.purple.opacity(0.7), in: Circle())
    }

    private func load() async {
        do {
            async let convosTask = api.conversations()
            async let requestsTask = api.friendRequests()
            let (convos, requests) = try await (convosTask, requestsTask)
            conversations = convos
            pendingCount = requests.count
            error = ""
        } catch {
            self.error = error.localizedDescription
            print("[Polycast] ConversationsView load error: \(error)")
        }
        loading = false
    }
}

private func formatRelativeTime(_ isoString: String?) -> String {
    guard let isoString, !isoString.isEmpty else { return "" }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: isoString) ?? ISO8601DateFormatter().date(from: isoString) else { return "" }

    let seconds = -date.timeIntervalSinceNow
    if seconds < 60 { return "now" }
    if seconds < 3600 { return "\(Int(seconds / 60))m" }
    if seconds < 86400 { return "\(Int(seconds / 3600))h" }
    if seconds < 172800 { return "Yesterday" }
    if seconds < 604800 { return "\(Int(seconds / 86400))d" }
    let df = DateFormatter()
    df.dateFormat = "MMM d"
    return df.string(from: date)
}
