import Foundation
import SocketIO

final class SocketClient: @unchecked Sendable {
    static let shared = SocketClient()

    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private var connected = false
    private var connectedToken: String?
    private var heartbeatTimer: Timer?

    private struct RegisteredHandler {
        let event: String
        let callback: ([Any]) -> Void
    }

    // Handlers survive socket recreation: connect() re-attaches them to the
    // new SocketIOClient, otherwise listeners registered before a reconnect
    // (e.g. CallManager's signal handlers) would be silently lost.
    private var registeredHandlers: [UUID: RegisteredHandler] = [:]

    // Fired on every (re)connect of the underlying socket, so features with
    // per-socket server state (transcription) can re-establish their session.
    private var connectHandlers: [UUID: () -> Void] = [:]

    private init() {}

    private func makeConfig(token: String) -> SocketIOClientConfiguration {
        [
            .forceWebsockets(true),
            .connectParams(["token": token]),
            .reconnects(true),
            .reconnectWait(2),
            .reconnectWaitMax(30),
        ]
    }

    func connect() {
        guard let token = APIClient.shared.token else {
            PolycastLog.runtime.error("[Polycast] SocketClient: no token, skipping connect")
            return
        }

        // A live socket stays up: recreating it drops server presence and
        // destroys per-socket server sessions (e.g. the transcription session
        // dies mid-call). If the auth token was renewed, hand the new token to
        // the manager so future auto-reconnects use it.
        if let socket, socket.status == .connected || socket.status == .connecting {
            if connectedToken != token {
                manager?.setConfigs(makeConfig(token: token))
                connectedToken = token
            }
            return
        }

        disconnect()

        let url = AppConfig.baseURL
        manager = SocketManager(socketURL: url, config: makeConfig(token: token))

        guard let socket = manager?.defaultSocket else { return }
        self.socket = socket

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            PolycastLog.runtime.error("[Polycast] Socket connected")
            self?.startHeartbeat()
            if let handlers = self?.connectHandlers.values {
                for handler in handlers {
                    handler()
                }
            }
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            PolycastLog.runtime.error("[Polycast] Socket disconnected")
            self?.stopHeartbeat()
        }

        socket.on(clientEvent: .reconnect) { _, _ in
            PolycastLog.runtime.error("[Polycast] Socket reconnected")
        }

        socket.on(clientEvent: .error) { data, _ in
            PolycastLog.runtime.error("[Polycast] Socket error: \(data)")
        }

        for (uuid, registered) in registeredHandlers {
            handlerMap[uuid] = socket.on(registered.event) { data, _ in
                registered.callback(data)
            }
        }

        socket.connect()
        connected = true
        connectedToken = token
    }

    func disconnect() {
        stopHeartbeat()
        socket?.disconnect()
        socket = nil
        manager?.disconnect()
        manager = nil
        connected = false
        connectedToken = nil
        handlerMap.removeAll()
    }

    // MARK: - Heartbeat

    private func startHeartbeat() {
        stopHeartbeat()
        DispatchQueue.main.async { [weak self] in
            self?.heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
                self?.socket?.emit("heartbeat")
            }
        }
    }

    private func stopHeartbeat() {
        DispatchQueue.main.async { [weak self] in
            self?.heartbeatTimer?.invalidate()
            self?.heartbeatTimer = nil
        }
    }

    var isConnected: Bool {
        socket?.status == .connected
    }

    // MARK: - Emit

    func emit(_ event: String, _ items: [SocketData] = []) {
        // Spread the array as the event's argument list (matching the JS
        // client) — the variadic overload would send one argument that is
        // an array, which the server then fails to parse.
        socket?.emit(event, with: items, completion: nil)
    }

    func emit(_ event: String, _ dict: [String: Any]) {
        socket?.emit(event, dict)
    }

    // MARK: - Listen

    @discardableResult
    func on(_ event: String, handler: @escaping ([Any]) -> Void) -> UUID? {
        let uuid = UUID()
        registeredHandlers[uuid] = RegisteredHandler(event: event, callback: handler)
        if let socket {
            // Store the SIO handler ID associated with a UUID for removal
            handlerMap[uuid] = socket.on(event) { data, _ in
                handler(data)
            }
        }
        return uuid
    }

    func off(_ uuid: UUID) {
        registeredHandlers.removeValue(forKey: uuid)
        guard let socket, let sioId = handlerMap.removeValue(forKey: uuid) else { return }
        socket.off(id: sioId)
    }

    @discardableResult
    func onConnect(_ handler: @escaping () -> Void) -> UUID {
        let uuid = UUID()
        connectHandlers[uuid] = handler
        return uuid
    }

    func offConnect(_ uuid: UUID) {
        connectHandlers.removeValue(forKey: uuid)
    }

    private var handlerMap: [UUID: UUID] = [:]
}
