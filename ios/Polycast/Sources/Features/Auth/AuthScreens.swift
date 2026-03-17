import SwiftUI

struct AuthContainerView: View {
    @State private var mode: AuthMode = .login

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [.purple.opacity(0.6), .blue.opacity(0.4), .black.opacity(0.95)],
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
                            .foregroundStyle(.white.opacity(0.7))
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
                .foregroundStyle(.white.opacity(0.5))
        }
        .padding(28)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28))
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
                .foregroundStyle(.white.opacity(0.5))
        }
        .padding(28)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28))
    }
}

// MARK: - Auth Field & Button Styles

private struct AuthFieldModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(.white)
    }
}

private struct AuthButtonModifier: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled

    func body(content: Content) -> some View {
        content
            .foregroundStyle(.white)
            .padding(.vertical, 14)
            .background(
                LinearGradient(
                    colors: [.purple, .blue],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .opacity(isEnabled ? 1 : 0.4),
                in: RoundedRectangle(cornerRadius: 16)
            )
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
