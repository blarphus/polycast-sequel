import SwiftUI

struct UserSearchSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [UserSearchResult] = []
    @State private var loading = false
    @State private var sentRequests: Set<String> = []
    @State private var searchTask: Task<Void, Never>?

    private let api = APIClient.shared

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search by username", text: $query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(10)
                .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 10))
                .padding()

                if loading {
                    ProgressView()
                        .padding()
                }

                if !loading && results.isEmpty && !query.isEmpty {
                    Text("No users found")
                        .foregroundStyle(.secondary)
                        .padding()
                }

                List(results) { user in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(user.username)
                                    .font(.headline)
                                if user.online == true {
                                    Circle()
                                        .fill(.green)
                                        .frame(width: 8, height: 8)
                                }
                            }
                            if let dn = user.displayName {
                                Text(dn)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

                        if sentRequests.contains(user.id) {
                            Label("Requested", systemImage: "checkmark")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Button("Add Friend") {
                                Task { await sendRequest(userId: user.id) }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.purple)
                            .controlSize(.small)
                        }
                    }
                }
                .listStyle(.plain)
            }
            .navigationTitle("Find Friends")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .onChange(of: query) {
            searchTask?.cancel()
            searchTask = Task {
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard !Task.isCancelled else { return }
                await search()
            }
        }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            results = []
            return
        }
        loading = true
        do {
            results = try await api.searchUsers(query: q)
        } catch {
            print("[Polycast] UserSearch error: \(error)")
        }
        loading = false
    }

    private func sendRequest(userId: String) async {
        do {
            try await api.sendFriendRequest(userId: userId)
            sentRequests.insert(userId)
        } catch {
            print("[Polycast] sendFriendRequest error: \(error)")
        }
    }
}
