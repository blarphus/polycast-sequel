import Foundation
@preconcurrency import WebRTC

enum CallStatus: Equatable {
    case idle
    case ringing
    case connecting
    case connected
    case ended(String) // reason
}

struct IncomingCallInfo {
    let callId: String
    let callerId: String
    let callerUsername: String
    let callerDisplayName: String
    let mode: CallMode
}

@MainActor
final class CallManager: ObservableObject {
    static let shared = CallManager()

    @Published var callStatus: CallStatus = .idle
    @Published var incomingCall: IncomingCallInfo?
    @Published var activeCallDisplayName: String = ""
    @Published var isCallViewPresented = false
    @Published private(set) var activeCallPeerId: String?
    @Published private(set) var remoteVideoTrack: RTCVideoTrack?
    @Published var isMuted = false
    @Published var isCameraOff = false
    @Published var callMode: CallMode = .video
    @Published var liveTranscript: String = ""
    @Published var transcriptEntries: [TranscriptEntry] = []

    private let socket = SocketClient.shared
    private let api = APIClient.shared
    private var webRTCClient: WebRTCClient?
    private var activeCallId: String?
    private var isCaller = false
    private var pendingOffer: [String: Any]?
    private var timeoutTask: Task<Void, Never>?
    private var isNegotiating = false

    private var listenerIds: [UUID] = []
    private var transcriptListenerIds: [UUID] = []

    private init() {}

    func startListening() {
        stopListening()

        let incomingId = socket.on("call:incoming") { [weak self] data in
            guard let dict = data.first as? [String: Any],
                  let callId = dict["callId"] as? String,
                  let callerId = dict["callerId"] as? String,
                  let username = dict["callerUsername"] as? String else { return }
            let displayName = dict["callerDisplayName"] as? String ?? username
            let modeStr = dict["mode"] as? String ?? "video"
            let mode: CallMode = modeStr == "audio" ? .audio : .video
            Task { @MainActor [weak self] in
                self?.receiveIncomingCall(
                    IncomingCallInfo(
                        callId: callId,
                        callerId: callerId,
                        callerUsername: username,
                        callerDisplayName: displayName,
                        mode: mode
                    )
                )
            }
        }

        let acceptedId = socket.on("call:accepted") { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isCaller else { return }
                self.callStatus = .connecting
                await self.createAndSendOffer()
            }
        }

        let rejectedId = socket.on("call:rejected") { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.endCallLocally(reason: "Call rejected")
            }
        }

        let endedId = socket.on("call:ended") { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.endCallLocally(reason: "Call ended")
            }
        }

        let errorId = socket.on("call:error") { [weak self] data in
            let message = (data.first as? [String: Any])?["message"] as? String ?? "Call error"
            Task { @MainActor [weak self] in
                self?.endCallLocally(reason: message)
            }
        }

        let offerId = socket.on("signal:offer") { [weak self] data in
            guard let dict = data.first as? [String: Any],
                  let offer = dict["offer"] as? [String: Any] else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.webRTCClient != nil {
                    await self.handleRemoteOffer(offer)
                } else {
                    self.pendingOffer = offer
                }
            }
        }

        let answerId = socket.on("signal:answer") { [weak self] data in
            guard let dict = data.first as? [String: Any],
                  let answer = dict["answer"] as? [String: Any] else { return }
            Task { @MainActor [weak self] in
                await self?.handleRemoteAnswer(answer)
            }
        }

        let iceId = socket.on("signal:ice-candidate") { [weak self] data in
            guard let dict = data.first as? [String: Any],
                  let candidateDict = dict["candidate"] as? [String: Any] else { return }
            Task { @MainActor [weak self] in
                self?.handleRemoteIceCandidate(candidateDict)
            }
        }

        listenerIds = [incomingId, acceptedId, rejectedId, endedId, errorId, offerId, answerId, iceId].compactMap { $0 }
    }

    func stopListening() {
        for id in listenerIds {
            socket.off(id)
        }
        listenerIds.removeAll()
    }

    // MARK: - Initiate Call (Caller)

    func initiateCall(peerId: String, displayName: String, mode: CallMode = .video) async {
        isCaller = true
        activeCallPeerId = peerId
        activeCallDisplayName = displayName
        callMode = mode
        callStatus = .ringing

        await setupWebRTC(mode: mode)
        let modeStr = mode == .audio ? "audio" : "video"
        socket.emit("call:initiate", ["peerId": peerId, "mode": modeStr])
        startTimeout()
    }

    // MARK: - Accept Call (Callee)

    func acceptCall(mode: CallMode = .video) async {
        guard let incoming = incomingCall else { return }
        isCaller = false
        activeCallId = incoming.callId
        activeCallPeerId = incoming.callerId
        activeCallDisplayName = incoming.callerDisplayName
        callMode = mode
        callStatus = .connecting
        isCallViewPresented = true
        incomingCall = nil

        socket.emit("call:accept", ["callerId": incoming.callerId])

        await setupWebRTC(mode: mode)

        if let offer = pendingOffer {
            pendingOffer = nil
            await handleRemoteOffer(offer)
        }

        startTimeout()
    }

    // MARK: - Reject Call

    func rejectCall() {
        guard let incoming = incomingCall else { return }
        socket.emit("call:reject", ["callerId": incoming.callerId])
        incomingCall = nil
        if let uuid = UUID(uuidString: incoming.callId) {
            VoIPPushManager.shared.reportCallEnded(uuid: uuid, reason: .declinedElsewhere)
        }
        activeCallId = nil
    }

    // MARK: - End Call

    func endCall() {
        guard let peerId = activeCallPeerId else { return }
        socket.emit("call:end", ["peerId": peerId])
        endCallLocally(reason: "Call ended")
    }

    func receiveIncomingCall(_ info: IncomingCallInfo) {
        activeCallId = info.callId
        incomingCall = info
        activeCallDisplayName = info.callerDisplayName
        callStatus = .ringing
    }

    func acceptIncomingCallFromSystem() async {
        guard let incoming = incomingCall else { return }
        activeCallDisplayName = incoming.callerDisplayName
        isCallViewPresented = true
        await acceptCall(mode: incoming.mode)
    }

    func endIncomingCallFromSystem() {
        if incomingCall != nil {
            rejectCall()
            callStatus = .idle
            return
        }
        endCall()
    }

    // MARK: - Controls

    func toggleMute() {
        isMuted = webRTCClient?.toggleMute() ?? false
    }

    func toggleCamera() {
        isCameraOff = webRTCClient?.toggleCamera() ?? false
    }

    func getLocalVideoTrack() -> RTCVideoTrack? {
        webRTCClient?.getLocalVideoTrack()
    }

    // MARK: - Transcription

    func startTranscription() {
        guard let peerId = activeCallPeerId else { return }

        socket.emit("transcription:start", ["peerId": peerId])

        // Listen for live transcript (partial)
        let transcriptId = socket.on("transcript") { [weak self] data in
            guard let dict = data.first as? [String: Any],
                  let text = dict["text"] as? String else { return }
            Task { @MainActor [weak self] in
                self?.liveTranscript = text
            }
        }

        // Listen for completed transcript entries
        let entryId = socket.on("transcript:entry") { [weak self] data in
            guard let dict = data.first as? [String: Any],
                  let userId = dict["userId"] as? String,
                  let displayName = dict["displayName"] as? String,
                  let text = dict["text"] as? String else { return }
            let lang = dict["lang"] as? String ?? "en"
            Task { @MainActor [weak self] in
                self?.transcriptEntries.append(TranscriptEntry(
                    userId: userId,
                    displayName: displayName,
                    text: text,
                    lang: lang
                ))
            }
        }

        transcriptListenerIds = [transcriptId, entryId].compactMap { $0 }

        // Start capturing PCM audio from microphone
        webRTCClient?.startAudioCapture { [weak self] pcmData in
            guard let self else { return }
            let base64 = pcmData.base64EncodedString()
            self.socket.emit("transcription:audio", [base64])
        }
    }

    func stopTranscription() {
        webRTCClient?.stopAudioCapture()
        socket.emit("transcription:stop")

        for id in transcriptListenerIds {
            socket.off(id)
        }
        transcriptListenerIds.removeAll()
    }

    // MARK: - Upgrade to Video

    func upgradeToVideo() {
        callMode = .video
        stopTranscription()
        webRTCClient?.addVideoTrack()
        // Renegotiation will be triggered by peerConnectionShouldNegotiate delegate
    }

    // MARK: - Private

    private func setupWebRTC(mode: CallMode = .video) async {
        let client = WebRTCClient()
        client.delegate = self
        self.webRTCClient = client

        do {
            let response = try await api.iceServers()
            client.createPeerConnection(iceServers: response.iceServers)
            client.addLocalStream(includeVideo: mode == .video)
        } catch {
            print("[Polycast] CallManager: failed to fetch ICE servers: \(error)")
            endCallLocally(reason: "Failed to set up connection")
        }
    }

    private func createAndSendOffer() async {
        guard let client = webRTCClient, let peerId = activeCallPeerId else { return }
        do {
            let sdp = try await client.createOffer()
            socket.emit("signal:offer", [
                "peerId": peerId,
                "offer": ["type": "offer", "sdp": sdp.sdp],
            ])
        } catch {
            print("[Polycast] CallManager: failed to create offer: \(error)")
            endCallLocally(reason: "Connection failed")
        }
    }

    private func handleRemoteOffer(_ offer: [String: Any]) async {
        guard let client = webRTCClient, let peerId = activeCallPeerId,
              let sdpString = offer["sdp"] as? String else { return }

        let remoteSDP = RTCSessionDescription(type: .offer, sdp: sdpString)
        do {
            let answer = try await client.createAnswer(remoteSDP: remoteSDP)
            socket.emit("signal:answer", [
                "peerId": peerId,
                "answer": ["type": "answer", "sdp": answer.sdp],
            ])
        } catch {
            print("[Polycast] CallManager: failed to create answer: \(error)")
            endCallLocally(reason: "Connection failed")
        }
    }

    private func handleRemoteAnswer(_ answer: [String: Any]) async {
        guard let client = webRTCClient,
              let sdpString = answer["sdp"] as? String else { return }

        let remoteSDP = RTCSessionDescription(type: .answer, sdp: sdpString)
        do {
            try await client.setRemoteDescription(remoteSDP)
            isNegotiating = false
        } catch {
            print("[Polycast] CallManager: failed to set remote answer: \(error)")
            endCallLocally(reason: "Connection failed")
        }
    }

    private func handleRemoteIceCandidate(_ candidateDict: [String: Any]) {
        guard let client = webRTCClient,
              let sdp = candidateDict["candidate"] as? String,
              let sdpMLineIndex = candidateDict["sdpMLineIndex"] as? Int32 else { return }

        let sdpMid = candidateDict["sdpMid"] as? String
        let candidate = RTCIceCandidate(sdp: sdp, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        client.addIceCandidate(candidate)
    }

    private func endCallLocally(reason: String) {
        let endedCallId = activeCallId
        stopTranscription()
        timeoutTask?.cancel()
        timeoutTask = nil
        callStatus = .ended(reason)
        isCallViewPresented = false
        incomingCall = nil
        activeCallId = nil
        activeCallPeerId = nil
        activeCallDisplayName = ""
        remoteVideoTrack = nil
        pendingOffer = nil
        isMuted = false
        isCameraOff = false
        callMode = .video
        liveTranscript = ""
        transcriptEntries = []
        isNegotiating = false
        webRTCClient?.close()
        webRTCClient = nil

        if let uuid = UUID(uuidString: endedCallId ?? "") {
            VoIPPushManager.shared.reportCallEnded(uuid: uuid, reason: .remoteEnded)
        }

        // Reset to idle after a brief display of the ended reason
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if case .ended = self.callStatus {
                self.callStatus = .idle
            }
        }
    }

    private func startTimeout() {
        timeoutTask?.cancel()
        timeoutTask = Task {
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            guard !Task.isCancelled else { return }
            if case .ringing = self.callStatus {
                self.endCall()
                self.endCallLocally(reason: "No answer")
            } else if case .connecting = self.callStatus {
                self.endCall()
                self.endCallLocally(reason: "Connection timed out")
            }
        }
    }
}

// MARK: - WebRTCClientDelegate

extension CallManager: WebRTCClientDelegate {
    nonisolated func webRTCClient(_ client: WebRTCClient, didReceiveRemoteVideoTrack track: RTCVideoTrack) {
        Task { @MainActor in
            self.remoteVideoTrack = track
            // If we receive a remote video track while in audio mode, the peer upgraded
            if self.callMode == .audio {
                self.callMode = .video
                self.stopTranscription()
            }
        }
    }

    nonisolated func webRTCClient(_ client: WebRTCClient, didGenerateIceCandidate candidate: RTCIceCandidate) {
        Task { @MainActor in
            guard let peerId = self.activeCallPeerId else { return }
            self.socket.emit("signal:ice-candidate", [
                "peerId": peerId,
                "candidate": [
                    "candidate": candidate.sdp,
                    "sdpMLineIndex": candidate.sdpMLineIndex,
                    "sdpMid": candidate.sdpMid ?? "",
                ],
            ])
        }
    }

    nonisolated func webRTCClient(_ client: WebRTCClient, didChangeConnectionState state: RTCIceConnectionState) {
        Task { @MainActor in
            switch state {
            case .connected, .completed:
                self.timeoutTask?.cancel()
                self.timeoutTask = nil
                self.callStatus = .connected
                // Auto-start transcription for all calls
                if self.transcriptListenerIds.isEmpty {
                    self.startTranscription()
                }
            case .failed:
                self.endCallLocally(reason: "Connection failed")
            case .disconnected:
                // Transient — don't treat as failure
                break
            default:
                break
            }
        }
    }

    nonisolated func webRTCClientShouldNegotiate(_ client: WebRTCClient) {
        Task { @MainActor in
            // Only renegotiate if connected and not already negotiating
            guard self.callStatus == .connected, !self.isNegotiating else { return }
            self.isNegotiating = true
            await self.createAndSendOffer()
        }
    }
}
