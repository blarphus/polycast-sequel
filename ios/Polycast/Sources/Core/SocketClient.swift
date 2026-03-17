import Foundation
import SocketIO

final class SocketClient: @unchecked Sendable {
    static let shared = SocketClient()

    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private var connected = false
    private var heartbeatTimer: Timer?

    private init() {}

    func connect() {
        guard let token = APIClient.shared.token else {
            print("[Polycast] SocketClient: no token, skipping connect")
            return
        }

        disconnect()

        let url = AppConfig.baseURL
        manager = SocketManager(socketURL: url, config: [
            .forceWebsockets(true),
            .connectParams(["token": token]),
            .reconnects(true),
            .reconnectWait(2),
            .reconnectWaitMax(30),
        ])

        guard let socket = manager?.defaultSocket else { return }
        self.socket = socket

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            print("[Polycast] Socket connected")
            self?.startHeartbeat()
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            print("[Polycast] Socket disconnected")
            self?.stopHeartbeat()
        }

        socket.on(clientEvent: .reconnect) { _, _ in
            print("[Polycast] Socket reconnected")
        }

        socket.on(clientEvent: .error) { data, _ in
            print("[Polycast] Socket error: \(data)")
        }

        socket.connect()
        connected = true
    }

    func disconnect() {
        stopHeartbeat()
        socket?.disconnect()
        socket = nil
        manager?.disconnect()
        manager = nil
        connected = false
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

    func emit(_ event: String, _ items: [Any] = []) {
        socket?.emit(event, items)
    }

    func emit(_ event: String, _ dict: [String: Any]) {
        socket?.emit(event, dict)
    }

    // MARK: - Listen

    @discardableResult
    func on(_ event: String, handler: @escaping ([Any]) -> Void) -> UUID? {
        guard let socket else { return nil }
        let id = socket.on(event) { data, _ in
            handler(data)
        }
        // Store the SIO handler ID associated with a UUID for removal
        let uuid = UUID()
        handlerMap[uuid] = id
        return uuid
    }

    func off(_ uuid: UUID) {
        guard let socket, let sioId = handlerMap.removeValue(forKey: uuid) else { return }
        socket.off(id: sioId)
    }

    func offAll(_ event: String) {
        socket?.off(event)
    }

    private var handlerMap: [UUID: UUID] = [:]
}
