// ---------------------------------------------------------------------------
// webrtc.ts -- WebRTC peer connection management
// ---------------------------------------------------------------------------

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Create a new RTCPeerConnection wired to the given callbacks.
 * Pass iceServers from the /api/ice-servers endpoint for TURN support.
 */
export function createPeerConnection(
  onTrack: (event: RTCTrackEvent) => void,
  onIceCandidate: (candidate: RTCIceCandidate | null) => void,
  onIceFailure?: () => void,
  iceServers?: RTCIceServer[],
): RTCPeerConnection {
  const pc = new RTCPeerConnection({
    iceServers: iceServers ?? DEFAULT_ICE_SERVERS,
  });

  pc.ontrack = onTrack;

  pc.onicecandidate = (event) => {
    onIceCandidate(event.candidate ?? null);
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[webrtc] ICE connection state:', pc.iceConnectionState);
    // Only treat 'failed' as fatal — 'disconnected' is transient and
    // the ICE agent may recover on its own.
    if (pc.iceConnectionState === 'failed') {
      onIceFailure?.();
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[webrtc] Connection state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      onIceFailure?.();
    }
  };

  return pc;
}

/**
 * Add local media tracks and create an SDP offer.
 */
export async function createOffer(
  pc: RTCPeerConnection,
  localStream: MediaStream,
): Promise<RTCSessionDescriptionInit> {
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return offer;
}

/**
 * Set remote offer, add local tracks, and create an SDP answer.
 */
export async function createAnswer(
  pc: RTCPeerConnection,
  offer: RTCSessionDescriptionInit,
  localStream: MediaStream,
): Promise<RTCSessionDescriptionInit> {
  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return answer;
}

/**
 * Add a trickle ICE candidate.
 */
export async function addIceCandidate(
  pc: RTCPeerConnection,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('[webrtc] Failed to add ICE candidate:', err);
  }
}

/**
 * Close and clean up the peer connection.
 */
export function closePeerConnection(pc: RTCPeerConnection): void {
  pc.ontrack = null;
  pc.onicecandidate = null;
  pc.oniceconnectionstatechange = null;
  pc.onconnectionstatechange = null;

  pc.getSenders().forEach((sender) => {
    try {
      pc.removeTrack(sender);
    } catch {
      // already closed
    }
  });

  pc.close();
}
