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
    @Published var isCallMinimized = false
    @Published private(set) var activeCallPeerId: String?
    @Published private(set) var remoteVideoTrack: RTCVideoTrack?
    @Published var isMuted = false
    @Published var isCameraOff = false
    @Published var isScreenSharing = false
    @Published var callMode: CallMode = .video
    @Published var liveTranscript: String = ""
    @Published var liveTranscriptLang: String = ""
    @Published var liveTranscriptUserId: String = ""
    @Published var transcriptEntries: [TranscriptEntry] = []

    private let socket = SocketClient.shared
    private let api = APIClient.shared
    private var webRTCClient: WebRTCClient?
    private var activeCallId: String?
    private var isCaller = false
    private var pendingOffer: [String: Any]?
    private var pendingOfferCallId: String?
    private var pendingIceCandidates: [[String: Any]] = []
    private var timeoutTask: Task<Void, Never>?
    private var isNegotiating = false

    private var listenerIds: [UUID] = []
    private var transcriptListenerIds: [UUID] = []
    private var reconnectHandlerId: UUID?

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

        let acceptedId = socket.on("call:accepted") { [weak self] data in
            let callId = (data.first as? [String: Any])?["callId"] as? String
            Task { @MainActor [weak self] in
                guard let self, self.isCaller else { return }
                if let callId { self.activeCallId = self.canonicalCallId(callId) }
                self.callStatus = .connecting
                await self.createAndSendOffer()
            }
        }

        let ringingId = socket.on("call:ringing") { [weak self] data in
            guard let dict = data.first as? [String: Any],
                  let callId = dict["callId"] as? String else { return }
            Task { @MainActor [weak self] in
                self?.activeCallId = self?.canonicalCallId(callId)
            }
        }

        let rejectedId = socket.on("call:rejected") { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.endCallLocally(reason: "Call rejected")
            }
        }

        let endedId = socket.on("call:ended") { [weak self] data in
            let reason = (data.first as? [String: Any])?["reason"] as? String
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.endCallLocally(reason: self.endReasonMessage(reason))
            }
        }

        let cancelledId = socket.on("call:cancelled") { [weak self] data in
            let reason = (data.first as? [String: Any])?["reason"] as? String ?? "Call cancelled"
            Task { @MainActor [weak self] in
                self?.endCallLocally(reason: reason)
            }
        }

        let busyId = socket.on("call:busy") { [weak self] data in
            let message = (data.first as? [String: Any])?["message"] as? String ?? "User is already in a call"
            Task { @MainActor [weak self] in
                self?.endCallLocally(reason: message)
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
            let callId = dict["callId"] as? String
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard self.acceptSignal(for: callId) else { return }
                if self.webRTCClient != nil {
                    await self.handleRemoteOffer(offer, callId: callId)
                } else {
                    self.pendingOffer = offer
                    self.pendingOfferCallId = callId.map(self.canonicalCallId)
                }
            }
        }

        let answerId = socket.on("signal:answer") { [weak self] data in
            guard let dict = data.first as? [String: Any],
                  let answer = dict["answer"] as? [String: Any] else { return }
            let callId = dict["callId"] as? String
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard self.acceptSignal(for: callId) else { return }
                await self.handleRemoteAnswer(answer)
            }
        }

        let iceId = socket.on("signal:ice-candidate") { [weak self] data in
            guard let dict = data.first as? [String: Any],
                  let candidateDict = dict["candidate"] as? [String: Any] else { return }
            let callId = dict["callId"] as? String
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard self.acceptSignal(for: callId) else { return }
                self.handleRemoteIceCandidate(candidateDict)
            }
        }

        listenerIds = [incomingId, ringingId, acceptedId, rejectedId, endedId, cancelledId, busyId, errorId, offerId, answerId, iceId].compactMap { $0 }

        // The server's transcription session lives on one socket; if the
        // socket reconnects mid-call (token renewal, network blip), the
        // session dies server-side and audio chunks are silently dropped.
        // Re-issue transcription:start on the fresh socket.
        reconnectHandlerId = socket.onConnect { [weak self] in
            Task { @MainActor [weak self] in
                guard let self,
                      self.callStatus == .connected,
                      !self.transcriptListenerIds.isEmpty,
                      let peerId = self.activeCallPeerId else { return }
                self.socket.emit("transcription:start", ["peerId": peerId])
            }
        }
    }

    func stopListening() {
        for id in listenerIds {
            socket.off(id)
        }
        listenerIds.removeAll()
        if let reconnectHandlerId {
            socket.offConnect(reconnectHandlerId)
            self.reconnectHandlerId = nil
        }
    }

    // MARK: - Initiate Call (Caller)

    func initiateCall(peerId: String, displayName: String, mode: CallMode = .video) async {
        isCaller = true
        activeCallId = nil
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
        let callId = canonicalCallId(incoming.callId)
        isCaller = false
        activeCallId = callId
        activeCallPeerId = incoming.callerId
        activeCallDisplayName = incoming.callerDisplayName
        callMode = mode
        callStatus = .connecting
        isCallViewPresented = true
        incomingCall = nil

        socket.emit("call:accept", ["callId": callId, "callerId": incoming.callerId])

        await setupWebRTC(mode: mode)

        if let offer = pendingOffer {
            let offerCallId = pendingOfferCallId
            pendingOffer = nil
            pendingOfferCallId = nil
            await handleRemoteOffer(offer, callId: offerCallId)
        }

        startTimeout()
    }

    // MARK: - Reject Call

    func rejectCall() {
        guard let incoming = incomingCall else { return }
        let callId = canonicalCallId(incoming.callId)
        socket.emit("call:reject", ["callId": callId, "callerId": incoming.callerId])
        incomingCall = nil
        if let uuid = UUID(uuidString: callId) {
            VoIPPushManager.shared.reportCallEnded(uuid: uuid, reason: .declinedElsewhere)
        }
        activeCallId = nil
    }

    // MARK: - End Call

    func endCall() {
        guard let peerId = activeCallPeerId else { return }
        if let activeCallId {
            socket.emit("call:end", ["callId": canonicalCallId(activeCallId), "peerId": peerId])
        } else {
            socket.emit("call:end", ["peerId": peerId])
        }
        endCallLocally(reason: "Call ended")
    }

    func receiveIncomingCall(_ info: IncomingCallInfo) {
        let callId = canonicalCallId(info.callId)
        activeCallId = callId
        incomingCall = IncomingCallInfo(
            callId: callId,
            callerId: info.callerId,
            callerUsername: info.callerUsername,
            callerDisplayName: info.callerDisplayName,
            mode: info.mode
        )
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

    // MARK: - Minimize / Restore

    func minimizeCall() {
        isCallMinimized = true
        isCallViewPresented = false
    }

    func restoreCall() {
        isCallMinimized = false
        isCallViewPresented = true
    }

    // MARK: - Controls

    func toggleMute() {
        isMuted = webRTCClient?.toggleMute() ?? false
    }

    func toggleCamera() {
        isCameraOff = webRTCClient?.toggleCamera() ?? false
    }

    func toggleScreenShare() {
        guard let client = webRTCClient else { return }
        if isScreenSharing {
            client.stopScreenShare()
            isScreenSharing = false
        } else {
            client.startScreenShare { [weak self] error in
                Task { @MainActor [weak self] in
                    if let error {
                        PolycastLog.runtime.error("[Polycast] CallManager: screen share failed: \(error)")
                    } else {
                        self?.isScreenSharing = true
                    }
                }
            }
        }
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
            let lang = dict["lang"] as? String ?? ""
            let userId = dict["userId"] as? String ?? ""
            Task { @MainActor [weak self] in
                self?.liveTranscript = text
                self?.liveTranscriptLang = lang
                self?.liveTranscriptUserId = userId
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

        do {
            let response = try await api.iceServers()
            client.createPeerConnection(iceServers: response.iceServers)
            client.addLocalStream(includeVideo: mode == .video)
            // Only publish the client once the peer connection exists — an
            // offer arriving during the ICE-server fetch must hit the
            // pendingOffer path, not a client with no peer connection.
            self.webRTCClient = client
        } catch {
            PolycastLog.runtime.error("[Polycast] CallManager: failed to fetch ICE servers: \(error)")
            endCallLocally(reason: "Failed to set up connection")
        }
    }

    private func endReasonMessage(_ reason: String?) -> String {
        let name = activeCallDisplayName.isEmpty ? "Your peer" : activeCallDisplayName
        switch reason {
        case "left": return "\(name) left the call"
        case "disconnected": return "\(name) disconnected"
        case "timeout": return "Connection timed out"
        default: return "Call ended"
        }
    }

    private func canonicalCallId(_ callId: String) -> String {
        if let uuid = UUID(uuidString: callId) {
            return uuid.uuidString.lowercased()
        }
        return callId.lowercased()
    }

    private func acceptSignal(for callId: String?) -> Bool {
        guard let callId else { return true }
        let canonicalId = canonicalCallId(callId)
        if let activeCallId, canonicalCallId(activeCallId) != canonicalId {
            reportFallback(
                code: "stale_call_signal_ignored",
                title: "Stale call update ignored",
                message: "Polycast ignored a signaling update for a call that is no longer active.",
                source: "ios.call",
                operation: "accept-signal",
                detail: "receivedCall=\(canonicalId); activeCall=\(self.canonicalCallId(activeCallId))",
                severity: "info"
            )
            return false
        }
        activeCallId = canonicalId
        return true
    }

    private func createAndSendOffer() async {
        guard let client = webRTCClient, let peerId = activeCallPeerId else { return }
        do {
            let sdp = try await client.createOffer()
            var payload: [String: Any] = [
                "peerId": peerId,
                "offer": ["type": "offer", "sdp": sdp.sdp],
            ]
            if let activeCallId { payload["callId"] = canonicalCallId(activeCallId) }
            socket.emit("signal:offer", payload)
        } catch {
            PolycastLog.runtime.error("[Polycast] CallManager: failed to create offer: \(error)")
            endCallLocally(reason: "Connection failed")
        }
    }

    private func handleRemoteOffer(_ offer: [String: Any], callId: String? = nil) async {
        guard let client = webRTCClient, let peerId = activeCallPeerId,
              let sdpString = offer["sdp"] as? String else { return }

        if let callId { activeCallId = canonicalCallId(callId) }
        let remoteSDP = RTCSessionDescription(type: .offer, sdp: sdpString)
        do {
            let answer = try await client.createAnswer(remoteSDP: remoteSDP)
            flushPendingIceCandidates()
            var payload: [String: Any] = [
                "peerId": peerId,
                "answer": ["type": "answer", "sdp": answer.sdp],
            ]
            if let activeCallId { payload["callId"] = canonicalCallId(activeCallId) }
            socket.emit("signal:answer", payload)
        } catch {
            PolycastLog.runtime.error("[Polycast] CallManager: failed to create answer: \(error)")
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
            flushPendingIceCandidates()
        } catch {
            PolycastLog.runtime.error("[Polycast] CallManager: failed to set remote answer: \(error)")
            endCallLocally(reason: "Connection failed")
        }
    }

    private func handleRemoteIceCandidate(_ candidateDict: [String: Any]) {
        // Buffer candidates until the peer connection exists and has a remote
        // description; they are flushed after the offer/answer is applied.
        guard let client = webRTCClient, client.hasRemoteDescription else {
            pendingIceCandidates.append(candidateDict)
            return
        }

        guard let sdp = candidateDict["candidate"] as? String,
              let sdpMLineIndexValue = candidateDict["sdpMLineIndex"] else { return }

        let sdpMLineIndex: Int32
        if let int32Value = sdpMLineIndexValue as? Int32 {
            sdpMLineIndex = int32Value
        } else if let intValue = sdpMLineIndexValue as? Int {
            sdpMLineIndex = Int32(intValue)
        } else {
            return
        }

        let sdpMid = candidateDict["sdpMid"] as? String
        let candidate = RTCIceCandidate(sdp: sdp, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        client.addIceCandidate(candidate)
    }

    private func flushPendingIceCandidates() {
        let candidates = pendingIceCandidates
        pendingIceCandidates.removeAll()
        for candidate in candidates {
            handleRemoteIceCandidate(candidate)
        }
    }

    private func endCallLocally(reason: String) {
        let endedCallId = activeCallId
        stopTranscription()
        timeoutTask?.cancel()
        timeoutTask = nil
        callStatus = .ended(reason)
        isCallViewPresented = false
        isCallMinimized = false
        incomingCall = nil
        activeCallId = nil
        activeCallPeerId = nil
        activeCallDisplayName = ""
        remoteVideoTrack = nil
        pendingOffer = nil
        pendingOfferCallId = nil
        pendingIceCandidates.removeAll()
        isMuted = false
        isCameraOff = false
        isScreenSharing = false
        callMode = .video
        liveTranscript = ""
        liveTranscriptLang = ""
        liveTranscriptUserId = ""
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
            var payload: [String: Any] = [
                "peerId": peerId,
                "candidate": [
                    "candidate": candidate.sdp,
                    "sdpMLineIndex": candidate.sdpMLineIndex,
                    "sdpMid": candidate.sdpMid ?? "",
                ],
            ]
            if let activeCallId = self.activeCallId {
                payload["callId"] = self.canonicalCallId(activeCallId)
            }
            self.socket.emit("signal:ice-candidate", payload)
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
