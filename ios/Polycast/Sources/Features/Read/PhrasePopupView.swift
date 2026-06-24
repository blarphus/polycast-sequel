import SwiftUI

/// Popup shown when a reader long-presses a sentence: translates the phrase and can explain it
/// using its surrounding paragraph for context.
struct PhrasePopupView: View {
    @EnvironmentObject private var session: SessionStore

    let context: PhraseContext
    let onDismiss: () -> Void

    @State private var translation: String?
    @State private var explanation: String?
    @State private var explaining = false
    @State private var error = ""

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { onDismiss() }

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Text(context.selection)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.purple)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button { onDismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }

                if let translation {
                    Text(translation)
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                } else if error.isEmpty {
                    ProgressView("Translating…")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }

                Button {
                    Task { await explain() }
                } label: {
                    if explaining {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Explain in context", systemImage: "text.bubble")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(.purple.opacity(0.15))
                            .foregroundStyle(.purple)
                            .clipShape(Capsule())
                    }
                }
                .disabled(explaining)

                if let explanation {
                    Text(renderTildeHighlight(explanation))
                        .font(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !error.isEmpty {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .padding(16)
            .frame(width: 320)
            .background(.ultraThinMaterial)
            .background(Color(.systemBackground).opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: .black.opacity(0.3), radius: 20, y: 8)
        }
        .task {
            guard translation == nil else { return }
            await translate()
        }
    }

    private func translate() async {
        guard let target = session.user?.targetLanguage else {
            error = "Set your target language in Settings first."
            return
        }
        do {
            translation = try await APIClient.shared.translatePhrase(
                phrase: context.selection,
                nativeLang: session.user?.nativeLanguage ?? "en",
                targetLang: target
            )
            error = ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func explain() async {
        explaining = true
        do {
            explanation = try await APIClient.shared.explainSelection(
                selection: context.selection,
                context: context.context,
                nativeLang: session.user?.nativeLanguage ?? "en",
                targetLang: session.user?.targetLanguage
            )
            error = ""
        } catch {
            self.error = error.localizedDescription
        }
        explaining = false
    }
}
