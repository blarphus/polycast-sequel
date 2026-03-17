import SwiftUI

struct IncomingCallView: View {
    @EnvironmentObject private var callManager: CallManager

    var body: some View {
        if let incoming = callManager.incomingCall {
            ZStack {
                Color.black.opacity(0.7)
                    .ignoresSafeArea()

                VStack(spacing: 24) {
                    Spacer()

                    // Caller info
                    VStack(spacing: 12) {
                        Text(incoming.callerDisplayName)
                            .font(.largeTitle.bold())
                            .foregroundStyle(.white)

                        Text(incoming.mode == .audio ? "Incoming audio call" : "Incoming video call")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.8))
                    }

                    Spacer()

                    // Accept / Reject buttons
                    HStack(spacing: 60) {
                        // Reject
                        Button {
                            callManager.rejectCall()
                        } label: {
                            VStack(spacing: 8) {
                                Image(systemName: "phone.down.fill")
                                    .font(.title)
                                    .foregroundStyle(.white)
                                    .frame(width: 64, height: 64)
                                    .background(Color.red, in: Circle())
                                Text("Decline")
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.8))
                            }
                        }

                        // Accept
                        Button {
                            callManager.isCallViewPresented = true
                            Task {
                                await callManager.acceptCall(mode: incoming.mode)
                            }
                        } label: {
                            VStack(spacing: 8) {
                                Image(systemName: incoming.mode == .audio ? "phone.fill" : "video.fill")
                                    .font(.title)
                                    .foregroundStyle(.white)
                                    .frame(width: 64, height: 64)
                                    .background(Color.green, in: Circle())
                                Text("Accept")
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.8))
                            }
                        }
                    }
                    .padding(.bottom, 60)
                }
            }
        }
    }
}
