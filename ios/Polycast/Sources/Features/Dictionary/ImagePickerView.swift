import SwiftUI

struct ImagePickerView: View {
    let initialQuery: String
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var images: [String] = []
    @State private var loading = false
    @State private var error = ""
    @State private var hasSearched = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    TextField("Search images...", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .submitLabel(.search)
                        .onSubmit { Task { await search() } }

                    Button("Search") {
                        Task { await search() }
                    }
                    .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || loading)
                }
                .padding()

                if !error.isEmpty {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                if loading {
                    Spacer()
                    ProgressView("Searching...")
                    Spacer()
                } else if images.isEmpty && hasSearched {
                    Spacer()
                    Text("No images found")
                        .foregroundStyle(.secondary)
                    Spacer()
                } else {
                    imageGrid
                }
            }
            .navigationTitle("Choose Image")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                query = initialQuery
                await search()
            }
        }
    }

    private var imageGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(images, id: \.self) { urlString in
                    if let url = APIClient.proxyImageURL(urlString) {
                        Button {
                            onSelect(urlString)
                            dismiss()
                        } label: {
                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .success(let image):
                                    image
                                        .resizable()
                                        .scaledToFill()
                                        .frame(height: 120)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                case .failure:
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(.secondary.opacity(0.2))
                                        .frame(height: 120)
                                        .overlay {
                                            Image(systemName: "exclamationmark.triangle")
                                                .foregroundStyle(.secondary)
                                        }
                                default:
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(.secondary.opacity(0.1))
                                        .frame(height: 120)
                                        .overlay { ProgressView() }
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding()
        }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }

        loading = true
        error = ""
        hasSearched = true

        do {
            images = try await APIClient.shared.searchImages(query: q)
        } catch {
            self.error = error.localizedDescription
        }

        loading = false
    }
}
