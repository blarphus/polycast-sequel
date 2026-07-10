import SwiftUI
@preconcurrency import WebRTC

/// Floating picture-in-picture tile shown while a call is minimized.
/// Draggable within the screen, snaps to the nearest horizontal edge,
/// and restores the full call view on tap.
struct MiniCallTileView: View {
    @EnvironmentObject private var callManager: CallManager

    @State private var position: CGPoint = .zero
    @State private var dragOffset: CGSize = .zero
    @State private var hasInitializedPosition = false

    private let tileSize = CGSize(width: 140, height: 180)
    private let edgeMargin: CGFloat = 12

    var body: some View {
        GeometryReader { geometry in
            tile
                .frame(width: tileSize.width, height: tileSize.height)
                .background(Color(white: 0.12))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(.white.opacity(0.2), lineWidth: 1))
                .shadow(color: .black.opacity(0.35), radius: 12, x: 0, y: 6)
                .position(
                    x: position.x + dragOffset.width,
                    y: position.y + dragOffset.height
                )
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            dragOffset = value.translation
                        }
                        .onEnded { value in
                            let raw = CGPoint(
                                x: position.x + value.translation.width,
                                y: position.y + value.translation.height
                            )
                            dragOffset = .zero
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                position = snapped(raw, in: geometry)
                            }
                        }
                )
                .onAppear {
                    if !hasInitializedPosition {
                        hasInitializedPosition = true
                        position = defaultPosition(in: geometry)
                    }
                }
        }
        .ignoresSafeArea(.keyboard)
    }

    private var tile: some View {
        ZStack {
            if callManager.callMode == .video, let track = callManager.remoteVideoTrack {
                RTCVideoViewRepresentable(track: track)
            } else {
                VStack(spacing: 6) {
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(.white.opacity(0.6))
                    Text("On call")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }

            VStack {
                HStack {
                    Text(callManager.activeCallDisplayName.isEmpty ? "Call" : callManager.activeCallDisplayName)
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.black.opacity(0.45), in: Capsule())
                    Spacer()
                }
                .padding(6)

                Spacer()

                HStack(spacing: 12) {
                    Button {
                        callManager.toggleMute()
                    } label: {
                        Image(systemName: callManager.isMuted ? "mic.slash.fill" : "mic.fill")
                            .font(.footnote)
                            .foregroundStyle(.white)
                            .frame(width: 30, height: 30)
                            .background(callManager.isMuted ? Color.red.opacity(0.8) : Color.white.opacity(0.25), in: Circle())
                    }

                    Button {
                        callManager.endCall()
                    } label: {
                        Image(systemName: "phone.down.fill")
                            .font(.footnote)
                            .foregroundStyle(.white)
                            .frame(width: 30, height: 30)
                            .background(Color.red, in: Circle())
                    }
                }
                .padding(.bottom, 8)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 16))
        .onTapGesture {
            callManager.restoreCall()
        }
    }

    // MARK: - Positioning

    private func defaultPosition(in geometry: GeometryProxy) -> CGPoint {
        CGPoint(
            x: geometry.size.width - tileSize.width / 2 - edgeMargin,
            y: geometry.size.height * 0.25
        )
    }

    private func snapped(_ point: CGPoint, in geometry: GeometryProxy) -> CGPoint {
        let minX = tileSize.width / 2 + edgeMargin
        let maxX = geometry.size.width - tileSize.width / 2 - edgeMargin
        let minY = tileSize.height / 2 + edgeMargin
        let maxY = geometry.size.height - tileSize.height / 2 - edgeMargin

        let clampedY = min(max(point.y, minY), maxY)
        // Snap to the nearest horizontal edge.
        let snappedX = point.x < geometry.size.width / 2 ? minX : maxX
        return CGPoint(x: snappedX, y: clampedY)
    }
}
