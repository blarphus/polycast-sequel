import SwiftUI

struct ChatView: View {
    let friendId: String
    let friendName: String

    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var callManager: CallManager
    @State private var messages: [ChatMessage] = []
    @State private var hasMore = false
    @State private var loading = true
    @State private var messageText = ""
    @State private var sending = false
    @State private var error = ""
    @State private var showCallView = false
    @FocusState private var inputFocused: Bool

    private let api = APIClient.shared

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        if hasMore {
                            Button("Load earlier messages") {
                                Task { await loadEarlier() }
                            }
                            .font(.subheadline)
                            .foregroundStyle(.purple)
                            .padding(.top, 8)
                        }

                        ForEach(messages) { msg in
                            messageBubble(msg)
                                .id(msg.id)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }
                .onChange(of: messages.count) {
                    if let last = messages.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
                .onAppear {
                    if let last = messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            if !error.isEmpty {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal)
            }

            inputBar
        }
        .texturedBackground()
        .navigationTitle(friendName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    showCallView = true
                    Task { await callManager.initiateCall(peerId: friendId, displayName: friendName, mode: .audio) }
                } label: {
                    Image(systemName: "phone.fill")
                }
                Button {
                    showCallView = true
                    Task { await callManager.initiateCall(peerId: friendId, displayName: friendName, mode: .video) }
                } label: {
                    Image(systemName: "video.fill")
                }
            }
        }
        .fullScreenCover(isPresented: $showCallView) {
            CallView(friendName: friendName)
                .environmentObject(callManager)
        }
        .task {
            await loadMessages()
            try? await api.markMessagesRead(friendId: friendId)
        }
        .onReceive(Timer.publish(every: 5, on: .main, in: .common).autoconnect()) { _ in
            Task { await pollNewMessages() }
        }
    }

    private func messageBubble(_ msg: ChatMessage) -> some View {
        let isOwn = msg.senderId == session.user?.id
        return HStack {
            if isOwn { Spacer(minLength: 60) }
            VStack(alignment: isOwn ? .trailing : .leading, spacing: 2) {
                Text(msg.body)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(isOwn ? Color.purple : Color(.systemGray5), in: RoundedRectangle(cornerRadius: 16))
                    .foregroundStyle(isOwn ? .white : .primary)

                HStack(spacing: 4) {
                    Text(formatTime(msg.createdAt))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if isOwn && msg.readAt != nil {
                        Text("Read")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if !isOwn { Spacer(minLength: 60) }
        }
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("Message", text: $messageText)
                .textFieldStyle(.roundedBorder)
                .focused($inputFocused)
                .onSubmit { Task { await send() } }

            Button {
                Task { await send() }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(messageText.trimmingCharacters(in: .whitespaces).isEmpty ? .gray : .purple)
            }
            .disabled(messageText.trimmingCharacters(in: .whitespaces).isEmpty || sending)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }

    private func loadMessages() async {
        do {
            let page = try await api.messages(friendId: friendId)
            messages = page.messages.reversed()
            hasMore = page.hasMore
        } catch {
            self.error = error.localizedDescription
            print("[Polycast] ChatView load error: \(error)")
        }
        loading = false
    }

    private func loadEarlier() async {
        guard let oldest = messages.first else { return }
        do {
            let page = try await api.messages(friendId: friendId, before: oldest.id)
            messages.insert(contentsOf: page.messages.reversed(), at: 0)
            hasMore = page.hasMore
        } catch {
            print("[Polycast] ChatView loadEarlier error: \(error)")
        }
    }

    private func send() async {
        let body = messageText.trimmingCharacters(in: .whitespaces)
        guard !body.isEmpty else { return }
        messageText = ""
        sending = true
        do {
            let msg = try await api.sendMessage(friendId: friendId, body: body)
            messages.append(msg)
            error = ""
        } catch {
            self.error = error.localizedDescription
            print("[Polycast] ChatView send error: \(error)")
        }
        sending = false
    }

    private func pollNewMessages() async {
        do {
            let page = try await api.messages(friendId: friendId)
            let fetched = page.messages.reversed() as [ChatMessage]
            if fetched.count > messages.count || fetched.last?.id != messages.last?.id {
                messages = Array(fetched)
                try? await api.markMessagesRead(friendId: friendId)
            }
        } catch {
            print("[Polycast] ChatView poll error: \(error)")
        }
    }

    private func formatTime(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: isoString) ?? ISO8601DateFormatter().date(from: isoString) else { return "" }
        let df = DateFormatter()
        df.dateFormat = "h:mm a"
        return df.string(from: date)
    }
}
