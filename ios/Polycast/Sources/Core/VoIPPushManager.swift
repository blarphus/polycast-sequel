import Foundation
@preconcurrency import PushKit
@preconcurrency import CallKit

final class VoIPPushManager: NSObject, @unchecked Sendable {
    static let shared = VoIPPushManager()

    private let registry = PKPushRegistry(queue: .main)
    private let provider: CXProvider
    private var currentDeviceToken: String?
    private var currentCallUUID: UUID?

    private override init() {
        let config = CXProviderConfiguration(localizedName: "Polycast")
        config.supportsVideo = true
        config.maximumCallsPerCallGroup = 1
        config.maximumCallGroups = 1
        config.includesCallsInRecents = false
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    func start() {
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
    }

    func refreshRegistration() {
        guard let token = currentDeviceToken else { return }
        guard APIClient.shared.token != nil else { return }
        let environment = currentEnvironment()
        let bundleId = Bundle.main.bundleIdentifier ?? "com.patron.polycast"

        Task {
            do {
                try await APIClient.shared.registerIOSVoIPToken(
                    deviceToken: token,
                    apnsEnvironment: environment,
                    bundleId: bundleId
                )
            } catch {
                print("[Polycast] Failed to register VoIP token: \(error)")
            }
        }
    }

    func unregisterCurrentToken() {
        guard let token = currentDeviceToken else { return }
        guard APIClient.shared.token != nil else { return }
        Task {
            do {
                try await APIClient.shared.unregisterIOSVoIPToken(deviceToken: token)
            } catch {
                print("[Polycast] Failed to unregister VoIP token: \(error)")
            }
        }
    }

    func reportCallEnded(uuid: UUID, reason: CXCallEndedReason) {
        provider.reportCall(with: uuid, endedAt: Date(), reason: reason)
        if currentCallUUID == uuid {
            currentCallUUID = nil
        }
    }

    private func currentEnvironment() -> String {
#if DEBUG
        return "sandbox"
#else
        return "production"
#endif
    }

    private func tokenString(from tokenData: Data) -> String {
        tokenData.map { String(format: "%02x", $0) }.joined()
    }

    private func ensureRealtimeReady() {
        guard APIClient.shared.token != nil else { return }
        SocketClient.shared.connect()
        Task { @MainActor in
            CallManager.shared.startListening()
        }
    }

    private func handleIncomingPush(_ payload: PKPushPayload) {
        guard let dict = payload.dictionaryPayload as? [String: Any],
              let callId = dict["callId"] as? String,
              let callerId = dict["callerId"] as? String,
              let callerUsername = dict["callerUsername"] as? String else {
            print("[Polycast] Invalid incoming VoIP payload: \(payload.dictionaryPayload)")
            return
        }

        let callerDisplayName = dict["callerDisplayName"] as? String ?? callerUsername
        let modeString = dict["mode"] as? String ?? "video"
        let mode: CallMode = modeString == "audio" ? .audio : .video
        let callUUID = UUID(uuidString: callId) ?? UUID()
        currentCallUUID = callUUID

        ensureRealtimeReady()

        let incoming = IncomingCallInfo(
            callId: callUUID.uuidString,
            callerId: callerId,
            callerUsername: callerUsername,
            callerDisplayName: callerDisplayName,
            mode: mode
        )

        Task { @MainActor in
            CallManager.shared.receiveIncomingCall(incoming)
        }

        let update = CXCallUpdate()
        update.localizedCallerName = callerDisplayName
        update.remoteHandle = CXHandle(type: .generic, value: callerUsername)
        update.hasVideo = mode == .video

        provider.reportNewIncomingCall(with: callUUID, update: update) { error in
            if let error {
                print("[Polycast] Failed to report incoming call: \(error)")
            }
        }
    }
}

extension VoIPPushManager: PKPushRegistryDelegate {
    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let token = tokenString(from: pushCredentials.token)
        currentDeviceToken = token
        refreshRegistration()
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        unregisterCurrentToken()
        currentDeviceToken = nil
    }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        guard type == .voIP else {
            completion()
            return
        }
        handleIncomingPush(payload)
        completion()
    }
}

extension VoIPPushManager: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        currentCallUUID = nil
        Task { @MainActor in
            CallManager.shared.endIncomingCallFromSystem()
        }
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        Task { @MainActor in
            await CallManager.shared.acceptIncomingCallFromSystem()
            CallManager.shared.isCallViewPresented = true
            action.fulfill()
        }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        Task { @MainActor in
            CallManager.shared.endIncomingCallFromSystem()
            action.fulfill()
        }
    }
}
