import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var session: SessionStore

    @State private var nativeLanguage = ""
    @State private var targetLanguage = ""
    @State private var dailyNewLimit = 5
    @State private var accountType = "student"
    @State private var cefrLevel = "A1"
    @State private var savedMessage = ""
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

                Picker("CEFR", selection: $cefrLevel) {
                    ForEach(LanguageOptions.cefrLevels, id: \.self) { level in
                        Text(level).tag(level)
                    }
                }
            }

            Section("Learning") {
                Stepper("Daily new words: \(dailyNewLimit)", value: $dailyNewLimit, in: 1...50)
                Picker("Role", selection: $accountType) {
                    Text("Student").tag("student")
                    Text("Teacher").tag("teacher")
                }
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
                        let success = await session.updateSettings(
                            nativeLanguage: nativeLanguage,
                            targetLanguage: targetLanguage,
                            dailyNewLimit: dailyNewLimit,
                            accountType: accountType,
                            cefrLevel: cefrLevel
                        )
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
            accountType = session.user?.accountType ?? "student"
            cefrLevel = session.user?.cefrLevel ?? "A1"
        }
    }
}
