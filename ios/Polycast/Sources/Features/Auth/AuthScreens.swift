import SwiftUI

struct AuthContainerView: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var mode: AuthMode = .login

    private var isDark: Bool { colorScheme == .dark }

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: isDark
                        ? [.purple.opacity(0.6), .blue.opacity(0.4), .black.opacity(0.95)]
                        : [
                            Color(red: 0.96, green: 0.88, blue: 1.0),
                            Color(red: 0.84, green: 0.91, blue: 1.0),
                            Color(red: 0.92, green: 0.96, blue: 1.0),
                        ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                VStack(spacing: 28) {
                    Spacer()

                    VStack(spacing: 12) {
                        Text("Polycast")
                            .font(.system(size: 44, weight: .bold, design: .rounded))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.purple, .blue],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                        Text("Language learning built around real media, transcripts, and review.")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(isDark ? Color.white.opacity(0.7) : Color.black.opacity(0.62))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }

                    Picker("Auth mode", selection: $mode) {
                        Text("Login").tag(AuthMode.login)
                        Text("Sign Up").tag(AuthMode.signup)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 32)

                    Group {
                        switch mode {
                        case .login:
                            LoginView(showSignup: { mode = .signup })
                        case .signup:
                            SignupView(showLogin: { mode = .login })
                        }
                    }
                    .frame(maxWidth: 520)
                    .padding(.horizontal, 8)

                    Spacer()
                }
                .padding()
            }
        }
    }
}

private enum AuthMode {
    case login
    case signup
}

struct LoginView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var username = ""
    @State private var password = ""

    let showSignup: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            TextField("Username", text: $username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .authFieldStyle()

            SecureField("Password", text: $password)
                .authFieldStyle()

            if let authError = session.authError, !authError.isEmpty {
                Text(authError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task {
                    _ = await session.login(username: username, password: password)
                }
            } label: {
                if session.isLoading {
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 22)
                } else {
                    Text("Log In")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 22)
                }
            }
            .authButtonStyle()
            .disabled(username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty || session.isLoading)

            Button("Create an account", action: showSignup)
                .buttonStyle(.plain)
                .authSecondaryActionStyle()
        }
        .padding(28)
        .authPanelStyle()
    }
}

struct SignupView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var displayName = ""
    @State private var username = ""
    @State private var password = ""

    let showLogin: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            TextField("Display Name", text: $displayName)
                .authFieldStyle()

            TextField("Username", text: $username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .authFieldStyle()

            SecureField("Password", text: $password)
                .authFieldStyle()

            if let authError = session.authError, !authError.isEmpty {
                Text(authError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task {
                    _ = await session.signup(username: username, password: password, displayName: displayName)
                }
            } label: {
                if session.isLoading {
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 22)
                } else {
                    Text("Create Account")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 22)
                }
            }
            .authButtonStyle()
            .disabled(displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.count < 6 || session.isLoading)

            Button("Already have an account?", action: showLogin)
                .buttonStyle(.plain)
                .authSecondaryActionStyle()
        }
        .padding(28)
        .authPanelStyle()
    }
}

// MARK: - Auth Field & Button Styles

private struct AuthFieldModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .padding(14)
            .background(
                colorScheme == .dark ? Color.white.opacity(0.08) : Color.white.opacity(0.82),
                in: RoundedRectangle(cornerRadius: 14)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .stroke(colorScheme == .dark ? Color.white.opacity(0.08) : Color.black.opacity(0.08))
            }
            .foregroundStyle(colorScheme == .dark ? Color.white : Color.black.opacity(0.84))
            .tint(colorScheme == .dark ? .white : .purple)
    }
}

private struct AuthPanelModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background(
                colorScheme == .dark ? Color.white.opacity(0.08) : Color.white.opacity(0.7),
                in: RoundedRectangle(cornerRadius: 28)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 28)
                    .stroke(colorScheme == .dark ? Color.white.opacity(0.08) : Color.white.opacity(0.8))
            }
            .shadow(color: .black.opacity(colorScheme == .dark ? 0.2 : 0.1), radius: 20, y: 10)
    }
}

private struct AuthSecondaryActionModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content.foregroundStyle(colorScheme == .dark ? Color.white.opacity(0.6) : Color.black.opacity(0.62))
    }
}

private struct AuthButtonModifier: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .foregroundStyle(
                isEnabled || colorScheme == .dark
                    ? Color.white
                    : Color.black.opacity(0.5)
            )
            .padding(.vertical, 14)
            .background(
                LinearGradient(
                    colors: [.purple, .blue],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .opacity(isEnabled ? 1 : (colorScheme == .dark ? 0.4 : 0.22)),
                in: RoundedRectangle(cornerRadius: 16)
            )
            .contentShape(RoundedRectangle(cornerRadius: 16))
    }
}

extension View {
    fileprivate func authFieldStyle() -> some View {
        modifier(AuthFieldModifier())
    }

    fileprivate func authButtonStyle() -> some View {
        buttonStyle(.plain)
            .modifier(AuthButtonModifier())
    }

    fileprivate func authPanelStyle() -> some View {
        modifier(AuthPanelModifier())
    }

    fileprivate func authSecondaryActionStyle() -> some View {
        modifier(AuthSecondaryActionModifier())
    }
}

struct OnboardingView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var nativeLanguage = LanguageOptions.all.first?.code ?? "en"
    @State private var targetLanguage = "es"
    @State private var dailyNewLimit = 5
    @State private var accountType = "student"
    @State private var cefrLevel = "A1"

    var body: some View {
        NavigationStack {
            Form {
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
                }

                Section("Learning") {
                    Stepper("Daily new words: \(dailyNewLimit)", value: $dailyNewLimit, in: 1...50)

                    Picker("CEFR Level", selection: $cefrLevel) {
                        ForEach(LanguageOptions.cefrLevels, id: \.self) { level in
                            Text(level).tag(level)
                        }
                    }
                }

                Section("Account") {
                    Picker("Role", selection: $accountType) {
                        Text("Student").tag("student")
                        Text("Teacher").tag("teacher")
                    }
                }

                if let authError = session.authError, !authError.isEmpty {
                    Section {
                        Text(authError)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task {
                            _ = await session.updateSettings(
                                nativeLanguage: nativeLanguage,
                                targetLanguage: targetLanguage,
                                dailyNewLimit: dailyNewLimit,
                                accountType: accountType,
                                cefrLevel: cefrLevel
                            )
                        }
                    } label: {
                        if session.isLoading {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Finish Setup")
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Set Up Polycast")
        }
    }
}
