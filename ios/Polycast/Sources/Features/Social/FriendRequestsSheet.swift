import SwiftUI

struct FriendRequestsSheet: View {
    var onUpdate: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var requests: [FriendRequest] = []
    @State private var loading = true
    @State private var processing: Set<String> = []

    private let api = APIClient.shared

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView()
                        .frame(maxHeight: .infinity)
                } else if requests.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "person.crop.circle.badge.questionmark")
                            .font(.system(size: 40))
                            .foregroundStyle(.secondary)
                        Text("No pending requests")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxHeight: .infinity)
                } else {
                    List {
                        ForEach(requests) { req in
                            requestRow(req)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Friend Requests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task {
            await load()
        }
    }

    private func requestRow(_ req: FriendRequest) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(req.displayName ?? req.username)
                    .font(.headline)
                if req.displayName != nil {
                    Text("@\(req.username)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if processing.contains(req.id) {
                ProgressView()
                    .controlSize(.small)
            } else {
                HStack(spacing: 12) {
                    Button {
                        Task { await accept(req) }
                    } label: {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.green)
                    }
                    .buttonStyle(.plain)

                    Button {
                        Task { await reject(req) }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func load() async {
        do {
            requests = try await api.friendRequests()
        } catch {
            print("[Polycast] FriendRequestsSheet load error: \(error)")
        }
        loading = false
    }

    private func accept(_ req: FriendRequest) async {
        processing.insert(req.id)
        do {
            try await api.acceptFriendRequest(id: req.id)
            requests.removeAll { $0.id == req.id }
            onUpdate()
        } catch {
            print("[Polycast] accept error: \(error)")
        }
        processing.remove(req.id)
    }

    private func reject(_ req: FriendRequest) async {
        processing.insert(req.id)
        do {
            try await api.rejectFriendRequest(id: req.id)
            requests.removeAll { $0.id == req.id }
            onUpdate()
        } catch {
            print("[Polycast] reject error: \(error)")
        }
        processing.remove(req.id)
    }
}
