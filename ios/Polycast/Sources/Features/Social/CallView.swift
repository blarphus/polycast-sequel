import SwiftUI
@preconcurrency import WebRTC

struct CallView: View {
    let friendName: String

    @EnvironmentObject private var callManager: CallManager
    @Environment(\.dismiss) private var dismiss
    @State private var showTranscript = true

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if callManager.callMode == .video {
                videoModeContent
            } else {
                audioModeContent
            }

            // Transcript overlay (both modes)
            if showTranscript && callManager.callStatus == .connected {
                transcriptOverlay
            }

            // Status overlay (shown when not connected)
            VStack {
                Spacer()

                if callManager.callStatus != .connected {
                    statusView
                        .padding(.bottom, 40)
                }

                controlBar
                    .padding(.bottom, 40)
            }
        }
        .onChange(of: callManager.callStatus) { _, newValue in
            if case .idle = newValue {
                dismiss()
            }
        }
        .statusBarHidden()
    }

    // MARK: - Video Mode

    private var videoModeContent: some View {
        ZStack {
            // Remote video (full screen)
            if let remoteTrack = callManager.remoteVideoTrack {
                RTCVideoViewRepresentable(track: remoteTrack)
                    .ignoresSafeArea()
            }

            // Local video preview (top-right inset)
            if let localTrack = callManager.getLocalVideoTrack(), !callManager.isCameraOff {
                RTCVideoViewRepresentable(track: localTrack, mirror: true)
                    .frame(width: 120, height: 160)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.3), lineWidth: 1))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(.top, 60)
                    .padding(.trailing, 16)
            }
        }
    }

    // MARK: - Audio Mode

    private var audioModeContent: some View {
        VStack(spacing: 0) {
            // Header
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
            .padding(.top, 80)

            Spacer()
        }
    }

    // MARK: - Transcript Overlay

    private var transcriptOverlay: some View {
        VStack(spacing: 0) {
            // Toggle button at top
            HStack {
                Spacer()
                Button {
                    withAnimation { showTranscript.toggle() }
                } label: {
                    Image(systemName: "captions.bubble.fill")
                        .font(.title3)
                        .foregroundStyle(.white)
                        .padding(10)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .padding(.top, 60)
                .padding(.trailing, callManager.callMode == .video ? 16 : 16)
            }

            Spacer()

            // Transcript panel at bottom
            VStack(alignment: .leading, spacing: 4) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            ForEach(callManager.transcriptEntries) { entry in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(entry.displayName)
                                        .font(.caption.bold())
                                        .foregroundStyle(.purple)

                                    Text(entry.text)
                                        .font(.callout)
                                        .foregroundStyle(.white)
                                }
                                .id(entry.id)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                    }
                    .onChange(of: callManager.transcriptEntries.count) {
                        if let last = callManager.transcriptEntries.last {
                            withAnimation {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                    }
                }
                .frame(maxHeight: 200)

                // Live partial transcript
                if !callManager.liveTranscript.isEmpty {
                    Text(callManager.liveTranscript)
                        .font(.callout)
                        .foregroundStyle(.white.opacity(0.5))
                        .padding(.horizontal, 16)
                        .padding(.bottom, 6)
                }
            }
            .background(.black.opacity(0.6))
            .padding(.bottom, 140) // Room for control bar
        }
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
        HStack(spacing: 32) {
            // Mute
            Button {
                callManager.toggleMute()
            } label: {
                Image(systemName: callManager.isMuted ? "mic.slash.fill" : "mic.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(callManager.isMuted ? Color.red.opacity(0.8) : Color.white.opacity(0.2), in: Circle())
            }

            // End call
            Button {
                callManager.endCall()
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
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
                        .frame(width: 56, height: 56)
                        .background(callManager.isCameraOff ? Color.red.opacity(0.8) : Color.white.opacity(0.2), in: Circle())
                }
            } else {
                // Upgrade to video (audio mode only)
                Button {
                    callManager.upgradeToVideo()
                } label: {
                    Image(systemName: "video.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 56, height: 56)
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
        view.videoContentMode = .scaleAspectFill
        view.clipsToBounds = true
        if mirror {
            view.transform = CGAffineTransform(scaleX: -1, y: 1)
        }
        track.add(view)
        return view
    }

    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {}

    static func dismantleUIView(_ uiView: RTCMTLVideoView, coordinator: ()) {
        // Track removal handled by WebRTCClient.close()
    }
}
