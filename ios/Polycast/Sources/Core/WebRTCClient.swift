import Foundation
import AVFoundation
@preconcurrency import WebRTC

protocol WebRTCClientDelegate: AnyObject {
    func webRTCClient(_ client: WebRTCClient, didReceiveRemoteVideoTrack track: RTCVideoTrack)
    func webRTCClient(_ client: WebRTCClient, didGenerateIceCandidate candidate: RTCIceCandidate)
    func webRTCClient(_ client: WebRTCClient, didChangeConnectionState state: RTCIceConnectionState)
    func webRTCClientShouldNegotiate(_ client: WebRTCClient)
}

final class WebRTCClient: NSObject, @unchecked Sendable {
    weak var delegate: WebRTCClientDelegate?

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        let encoderFactory = RTCDefaultVideoEncoderFactory()
        let decoderFactory = RTCDefaultVideoDecoderFactory()
        return RTCPeerConnectionFactory(encoderFactory: encoderFactory, decoderFactory: decoderFactory)
    }()

    private var peerConnection: RTCPeerConnection?
    private var localVideoTrack: RTCVideoTrack?
    private var localAudioTrack: RTCAudioTrack?
    private var videoCapturer: RTCCameraVideoCapturer?
    private(set) var localVideoSource: RTCVideoSource?

    private var isMuted = false
    private var isCameraOff = false
    private var hasVideoTrack = false

    private var audioEngine: AVAudioEngine?
    private var audioConverter: AVAudioConverter?

    // MARK: - Setup

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch {
            print("[Polycast] WebRTC: audio session config error: \(error)")
        }
    }

    func createPeerConnection(iceServers: [IceServer]) {
        configureAudioSession()

        let config = RTCConfiguration()
        config.iceServers = iceServers.map { server in
            RTCIceServer(
                urlStrings: server.urls.allURLs,
                username: server.username,
                credential: server.credential
            )
        }
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
        )

        peerConnection = Self.factory.peerConnection(
            with: config,
            constraints: constraints,
            delegate: self
        )
    }

    func addLocalStream(includeVideo: Bool = true) {
        guard let pc = peerConnection else { return }

        // Audio
        let audioConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let audioSource = Self.factory.audioSource(with: audioConstraints)
        localAudioTrack = Self.factory.audioTrack(with: audioSource, trackId: "audio0")
        if let audioTrack = localAudioTrack {
            pc.add(audioTrack, streamIds: ["stream0"])
        }

        // Video (only if requested)
        if includeVideo {
            addVideoTrackInternal()
        }
    }

    private func addVideoTrackInternal() {
        guard let pc = peerConnection, !hasVideoTrack else { return }

        let videoSource = Self.factory.videoSource()
        self.localVideoSource = videoSource
        localVideoTrack = Self.factory.videoTrack(with: videoSource, trackId: "video0")
        if let videoTrack = localVideoTrack {
            pc.add(videoTrack, streamIds: ["stream0"])
        }
        hasVideoTrack = true

        let capturer = RTCCameraVideoCapturer(delegate: videoSource)
        self.videoCapturer = capturer
        startCapture(capturer: capturer)
    }

    /// Add video track mid-call (for audio→video upgrade)
    func addVideoTrack() {
        addVideoTrackInternal()
    }

    private func startCapture(capturer: RTCCameraVideoCapturer) {
        guard let device = RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == .front })
                ?? RTCCameraVideoCapturer.captureDevices().first else {
            print("[Polycast] WebRTC: no camera device found")
            return
        }

        let format = device.activeFormat
        let fps = min(30, format.videoSupportedFrameRateRanges.first?.maxFrameRate ?? 30)

        capturer.startCapture(with: device, format: format, fps: Int(fps)) { error in
            if let error {
                print("[Polycast] WebRTC: capture start error: \(error)")
            }
        }
    }

    // MARK: - SDP

    func createOffer() async throws -> RTCSessionDescription {
        guard let pc = peerConnection else { throw WebRTCError.noPeerConnection }

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "true",
                "OfferToReceiveVideo": "true",
            ],
            optionalConstraints: nil
        )

        return try await withCheckedThrowingContinuation { continuation in
            pc.offer(for: constraints) { sdp, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let sdp else {
                    continuation.resume(throwing: WebRTCError.sdpCreationFailed)
                    return
                }
                pc.setLocalDescription(sdp) { error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: sdp)
                    }
                }
            }
        }
    }

    func createAnswer(remoteSDP: RTCSessionDescription) async throws -> RTCSessionDescription {
        guard let pc = peerConnection else { throw WebRTCError.noPeerConnection }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            pc.setRemoteDescription(remoteSDP) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "true",
                "OfferToReceiveVideo": "true",
            ],
            optionalConstraints: nil
        )

        return try await withCheckedThrowingContinuation { continuation in
            pc.answer(for: constraints) { sdp, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let sdp else {
                    continuation.resume(throwing: WebRTCError.sdpCreationFailed)
                    return
                }
                pc.setLocalDescription(sdp) { error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: sdp)
                    }
                }
            }
        }
    }

    func setRemoteDescription(_ sdp: RTCSessionDescription) async throws {
        guard let pc = peerConnection else { throw WebRTCError.noPeerConnection }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            pc.setRemoteDescription(sdp) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    // MARK: - ICE

    func addIceCandidate(_ candidate: RTCIceCandidate) {
        peerConnection?.add(candidate) { error in
            if let error {
                print("[Polycast] WebRTC: failed to add ICE candidate: \(error)")
            }
        }
    }

    // MARK: - Controls

    func toggleMute() -> Bool {
        isMuted.toggle()
        localAudioTrack?.isEnabled = !isMuted
        return isMuted
    }

    func toggleCamera() -> Bool {
        isCameraOff.toggle()
        localVideoTrack?.isEnabled = !isCameraOff
        return isCameraOff
    }

    func getLocalVideoTrack() -> RTCVideoTrack? {
        localVideoTrack
    }

    // MARK: - PCM Audio Capture (for transcription)

    func startAudioCapture(onChunk: @escaping (Data) -> Void) {
        let engine = AVAudioEngine()
        self.audioEngine = engine

        let inputNode = engine.inputNode
        let hardwareFormat = inputNode.outputFormat(forBus: 0)

        // Target: 16kHz, 16-bit signed integer, mono
        guard let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true) else {
            print("[Polycast] WebRTC: failed to create target audio format")
            return
        }

        guard let converter = AVAudioConverter(from: hardwareFormat, to: targetFormat) else {
            print("[Polycast] WebRTC: failed to create audio converter")
            return
        }
        self.audioConverter = converter

        // Tap at hardware format, convert to 16kHz mono PCM
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: hardwareFormat) { [weak self] buffer, _ in
            guard let self, let converter = self.audioConverter else { return }

            let frameCapacity = AVAudioFrameCount(targetFormat.sampleRate * Double(buffer.frameLength) / hardwareFormat.sampleRate)
            guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCapacity) else { return }

            var error: NSError?
            converter.convert(to: convertedBuffer, error: &error) { _, outStatus in
                outStatus.pointee = .haveData
                return buffer
            }

            if let error {
                print("[Polycast] WebRTC: audio conversion error: \(error)")
                return
            }

            guard convertedBuffer.frameLength > 0,
                  let channelData = convertedBuffer.int16ChannelData else { return }

            let data = Data(bytes: channelData[0], count: Int(convertedBuffer.frameLength) * 2)
            onChunk(data)
        }

        do {
            try engine.start()
        } catch {
            print("[Polycast] WebRTC: audio engine start error: \(error)")
        }
    }

    func stopAudioCapture() {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        audioConverter = nil
    }

    // MARK: - Cleanup

    func close() {
        stopAudioCapture()
        videoCapturer?.stopCapture()
        videoCapturer = nil
        localVideoTrack = nil
        localAudioTrack = nil
        localVideoSource = nil
        hasVideoTrack = false

        // removeTrack can throw if connection already closed — this is cleanup
        try? peerConnection?.close()
        peerConnection = nil
    }
}

// MARK: - RTCPeerConnectionDelegate

extension WebRTCClient: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        if let videoTrack = stream.videoTracks.first {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.delegate?.webRTCClient(self, didReceiveRemoteVideoTrack: videoTrack)
            }
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}

    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.delegate?.webRTCClientShouldNegotiate(self)
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.delegate?.webRTCClient(self, didChangeConnectionState: newState)
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        delegate?.webRTCClient(self, didGenerateIceCandidate: candidate)
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}

// MARK: - Errors

enum WebRTCError: LocalizedError {
    case noPeerConnection
    case sdpCreationFailed

    var errorDescription: String? {
        switch self {
        case .noPeerConnection: return "No peer connection available."
        case .sdpCreationFailed: return "Failed to create session description."
        }
    }
}
