import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var session: SessionStore

    @State private var nativeLanguage = ""
    @State private var targetLanguage = ""
    @State private var dailyNewLimit = 5
    @State private var cefrLevel = "A1"
    @State private var savedMessage = ""
    @State private var savingTargetLanguage = false
    @AppStorage(BackgroundTexture.storageKey) private var bgTextureRaw: String = BackgroundTexture.dots.rawValue
    @AppStorage(AppTheme.storageKey) private var themeRaw: String = AppTheme.dark.rawValue

    private var bgTexture: BackgroundTexture {
        get { BackgroundTexture(rawValue: bgTextureRaw) ?? .dots }
    }

    private var appTheme: AppTheme {
        get { AppTheme(rawValue: themeRaw) ?? .dark }
    }

    var body: some View {
        Form {
            Section("Profile") {
                LabeledContent("Username", value: session.user?.username ?? "—")
                LabeledContent("Display Name", value: session.user?.displayName ?? "—")
                LabeledContent("API", value: AppConfig.baseURL.absoluteString)
                    .font(.footnote)
            }

            Section("Languages") {
                Picker("Native Language", selection: $nativeLanguage) {
                    ForEach(LanguageOptions.all) { language in
                        Text(language.name).tag(language.code)
                    }
                }

                Picker("Target Language", selection: $targetLanguage) {
                    ForEach(LanguageOptions.all.filter { $0.code != nativeLanguage }) { language in
                        Text(language.name).tag(language.code)
                    }
                }

                if savingTargetLanguage {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Switching target language...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Picker("CEFR", selection: $cefrLevel) {
                    ForEach(LanguageOptions.cefrLevels, id: \.self) { level in
                        Text(level).tag(level)
                    }
                }
            }

            Section("Learning") {
                Stepper("Daily new words: \(dailyNewLimit)", value: $dailyNewLimit, in: 1...50)
            }

            Section("Appearance") {
                Picker("Theme", selection: $themeRaw) {
                    ForEach(AppTheme.allCases, id: \.self) { theme in
                        Text(theme.rawValue).tag(theme.rawValue)
                    }
                }

                Picker("Background", selection: $bgTextureRaw) {
                    ForEach(BackgroundTexture.allCases, id: \.self) { texture in
                        Text(texture.rawValue).tag(texture.rawValue)
                    }
                }
            }

            if let authError = session.authError, !authError.isEmpty {
                Section {
                    Text(authError)
                        .foregroundStyle(.red)
                }
            }

            if !savedMessage.isEmpty {
                Section {
                    Text(savedMessage)
                        .foregroundStyle(.green)
                }
            }

            Section {
                Button("Save Settings") {
                    Task {
                        let success = await saveSettings()
                        savedMessage = success ? "Settings saved." : ""
                    }
                }

                Button("Log Out", role: .destructive) {
                    session.logout()
                }
            }
        }
        .texturedBackground()
        .navigationTitle("Settings")
        .toolbarBackground(.hidden, for: .navigationBar)
        .onAppear {
            nativeLanguage = session.user?.nativeLanguage ?? "en"
            targetLanguage = session.user?.targetLanguage ?? "es"
            dailyNewLimit = session.user?.dailyNewLimit ?? 5
            cefrLevel = session.user?.cefrLevel ?? "A1"
        }
        .onChange(of: targetLanguage) { _, newValue in
            guard !newValue.isEmpty, newValue != session.user?.targetLanguage else { return }
            Task {
                savingTargetLanguage = true
                let success = await saveSettings()
                savingTargetLanguage = false
                savedMessage = success ? "Target language switched." : ""
            }
        }
    }

    private func saveSettings() async -> Bool {
        await session.updateSettings(
            nativeLanguage: nativeLanguage,
            targetLanguage: targetLanguage,
            dailyNewLimit: dailyNewLimit,
            accountType: session.user?.accountType ?? "student",
            cefrLevel: cefrLevel
        )
    }
}
