import SwiftUI
@preconcurrency import WebRTC

struct CallView: View {
    let friendName: String

    @EnvironmentObject private var callManager: CallManager
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var dailyGoal = DailyWordGoalStore.shared
    @State private var showTranscript = true
    @State private var selectedLookup: LookupContext?
    // Required by InlineTokenizedText; calls have no player to pause.
    @State private var pausedForLookup = false
    @State private var showNotTargetToast = false
    @State private var notTargetToastTask: Task<Void, Never>?

    private var transcriptVisible: Bool {
        showTranscript && callManager.callStatus == .connected
    }

    var body: some View {
        GeometryReader { geometry in
            let isLandscape = geometry.size.width > geometry.size.height

            ZStack {
                Color.black.ignoresSafeArea()

                // Video/audio content with the transcript beside (landscape)
                // or below (portrait) it, so letterbox space isn't wasted.
                if isLandscape {
                    HStack(spacing: 0) {
                        mediaArea
                        if transcriptVisible {
                            transcriptPanel
                                .frame(width: min(360, geometry.size.width * 0.42))
                                .background(Color(white: 0.07))
                        }
                    }
                } else {
                    VStack(spacing: 0) {
                        mediaArea
                        if transcriptVisible {
                            transcriptPanel
                                .frame(height: geometry.size.height * 0.35)
                                .background(Color(white: 0.07))
                        }
                    }
                }

                // Transcript toggle (top-right)
                VStack {
                    HStack {
                        Spacer()
                        Button {
                            withAnimation { showTranscript.toggle() }
                        } label: {
                            Image(systemName: "captions.bubble.fill")
                                .font(.title3)
                                .foregroundStyle(showTranscript ? .white : .white.opacity(0.5))
                                .padding(10)
                                .background(.ultraThinMaterial, in: Circle())
                        }
                    }
                    Spacer()
                }
                .padding(.top, 8)
                .padding(.trailing, 16)

                // Word lookup popup (tapped transcript word)
                if let lookup = selectedLookup {
                    WordPopupView(context: lookup) {
                        selectedLookup = nil
                    }
                }

                if showNotTargetToast {
                    notTargetToast
                }

                if let celebration = dailyGoal.celebration {
                    VStack {
                        DailyGoalCelebrationView(celebration: celebration)
                        Spacer()
                    }
                    .padding(.top, 12)
                    .padding(.horizontal, 16)
                    .zIndex(40)
                }
            }
        }
        .onAppear { OrientationController.unlockRotation() }
        .onDisappear { OrientationController.leaveLandscape() }
        .onChange(of: callManager.callStatus) { _, newValue in
            if case .idle = newValue {
                dismiss()
            }
        }
        .statusBarHidden()
    }

    // MARK: - Media Area (video or audio header + controls overlay)

    private var mediaArea: some View {
        ZStack {
            if callManager.callMode == .video {
                if let remoteTrack = callManager.remoteVideoTrack {
                    RTCVideoViewRepresentable(track: remoteTrack)
                }

                // Local preview (top-leading inset, clear of the toggle button)
                if let localTrack = callManager.getLocalVideoTrack(), !callManager.isCameraOff {
                    RTCVideoViewRepresentable(track: localTrack, mirror: !callManager.isScreenSharing)
                        .frame(width: 100, height: 140)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.3), lineWidth: 1))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(.top, 12)
                        .padding(.leading, 12)
                }
            } else {
                audioModeContent
            }

            VStack {
                Spacer()
                if callManager.callStatus != .connected {
                    statusView
                        .padding(.bottom, 24)
                }
                controlBar
                    .padding(.bottom, 16)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    // MARK: - Audio Mode

    private var audioModeContent: some View {
        VStack(spacing: 8) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.white.opacity(0.6))

            Text(friendName)
                .font(.title2.bold())
                .foregroundStyle(.white)

            Text("Audio Call")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.6))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Transcript Panel

    private var transcriptPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("CONVERSATION")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white.opacity(0.45))
                    Text("Live transcript")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                }
                Spacer()
                ForEach(detectedLanguages, id: \.self) { lang in
                    HStack(spacing: 4) {
                        Circle().fill(.teal).frame(width: 5, height: 5)
                        Text(languageName(lang))
                            .lineLimit(1)
                    }
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white.opacity(0.72))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .overlay(Capsule().stroke(.white.opacity(0.15)))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider().overlay(.white.opacity(0.1))

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(callManager.transcriptEntries) { entry in
                            HStack(alignment: .top, spacing: 10) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(speakerColor(for: entry.userId))
                                    .frame(width: 3)

                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        Text(entry.displayName)
                                            .font(.caption.bold())
                                            .foregroundStyle(speakerColor(for: entry.userId))
                                        Text(languageName(entry.lang).uppercased())
                                            .font(.system(size: 8, weight: .bold))
                                            .foregroundStyle(.white.opacity(0.38))
                                    }

                                    InlineTokenizedText(
                                        text: entry.text,
                                        sentence: entry.text,
                                        selectedLookup: $selectedLookup,
                                        pausedForLookup: $pausedForLookup,
                                        font: .callout,
                                        textColor: .white,
                                        onWordTap: { word in
                                            handleWordTap(word, entry: entry)
                                        }
                                    )
                                }
                            }
                            .id(entry.id)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                .onChange(of: callManager.transcriptEntries.count) {
                    if let last = callManager.transcriptEntries.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            // Live partial transcript
            if !callManager.liveTranscript.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    if !callManager.liveTranscriptLang.isEmpty {
                        Text("SPEAKING · \(languageName(callManager.liveTranscriptLang).uppercased())")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(.teal)
                    }
                    Text(callManager.liveTranscript)
                        .font(.callout)
                        .foregroundStyle(.white.opacity(0.58))
                }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
        }
    }

    private var detectedLanguages: [String] {
        let recent = callManager.transcriptEntries.suffix(12).map(\.lang)
        let values = recent + (callManager.liveTranscriptLang.isEmpty ? [] : [callManager.liveTranscriptLang])
        return Array(Set(values)).sorted().prefix(2).map { $0 }
    }

    private func languageName(_ code: String) -> String {
        Locale.current.localizedString(forLanguageCode: primarySubtag(code)) ?? code.uppercased()
    }

    private func handleWordTap(_ word: String, entry: TranscriptEntry) {
        if isTargetLanguage(entry.lang) {
            selectedLookup = LookupContext(word: word, sentence: entry.text)
        } else {
            notTargetToastTask?.cancel()
            showNotTargetToast = true
            notTargetToastTask = Task {
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                guard !Task.isCancelled else { return }
                showNotTargetToast = false
            }
        }
    }

    private func isTargetLanguage(_ lang: String) -> Bool {
        guard let target = session.user?.targetLanguage else { return true }
        return primarySubtag(lang) == primarySubtag(target)
    }

    private func primarySubtag(_ lang: String) -> String {
        lang.lowercased().split(separator: "-").first.map(String.init) ?? lang.lowercased()
    }

    private var notTargetToast: some View {
        VStack {
            Spacer()
            Text("Not in your target language")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.black.opacity(0.8), in: Capsule())
                .padding(.bottom, 120)
        }
        .transition(.opacity)
    }

    // MARK: - Shared Components

    private var statusView: some View {
        VStack(spacing: 8) {
            Text(friendName)
                .font(.title2.bold())
                .foregroundStyle(.white)

            Text(statusText)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.8))
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private var statusText: String {
        switch callManager.callStatus {
        case .idle: return ""
        case .ringing: return "Ringing..."
        case .connecting: return "Connecting..."
        case .connected: return "Connected"
        case .ended(let reason): return reason
        }
    }

    private var controlBar: some View {
        HStack(spacing: 24) {
            // Mute
            Button {
                callManager.toggleMute()
            } label: {
                Image(systemName: callManager.isMuted ? "mic.slash.fill" : "mic.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(callManager.isMuted ? Color.red.opacity(0.8) : Color.white.opacity(0.2), in: Circle())
            }

            // End call
            Button {
                callManager.endCall()
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 60, height: 60)
                    .background(Color.red, in: Circle())
            }

            if callManager.callMode == .video {
                // Camera toggle (video mode only)
                Button {
                    callManager.toggleCamera()
                } label: {
                    Image(systemName: callManager.isCameraOff ? "video.slash.fill" : "video.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 52, height: 52)
                        .background(callManager.isCameraOff ? Color.red.opacity(0.8) : Color.white.opacity(0.2), in: Circle())
                }

                // Screen share (in-app screen)
                Button {
                    callManager.toggleScreenShare()
                } label: {
                    Image(systemName: "rectangle.on.rectangle")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 52, height: 52)
                        .background(callManager.isScreenSharing ? Color.green.opacity(0.8) : Color.white.opacity(0.2), in: Circle())
                }
            } else {
                // Upgrade to video (audio mode only)
                Button {
                    callManager.upgradeToVideo()
                } label: {
                    Image(systemName: "video.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 52, height: 52)
                        .background(Color.purple.opacity(0.8), in: Circle())
                }
            }
        }
    }
}

// MARK: - RTCVideoView wrapper

struct RTCVideoViewRepresentable: UIViewRepresentable {
    let track: RTCVideoTrack
    var mirror: Bool = false

    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView()
        // Aspect-fit so the peer's whole frame is visible regardless of the
        // two devices' screen shapes (letterboxed instead of cropped).
        view.videoContentMode = .scaleAspectFit
        view.clipsToBounds = true
        if mirror {
            view.transform = CGAffineTransform(scaleX: -1, y: 1)
        }
        track.add(view)
        return view
    }

    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {
        uiView.transform = mirror ? CGAffineTransform(scaleX: -1, y: 1) : .identity
    }

    static func dismantleUIView(_ uiView: RTCMTLVideoView, coordinator: ()) {
        // Track removal handled by WebRTCClient.close()
    }
}
