// ---------------------------------------------------------------------------
// webrtc.ts -- WebRTC peer connection management
// ---------------------------------------------------------------------------

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Free TURN relay for NAT traversal across networks
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/**
 * Create a new RTCPeerConnection wired to the given callbacks.
 */
export function createPeerConnection(
  onTrack: (event: RTCTrackEvent) => void,
  onIceCandidate: (candidate: RTCIceCandidate | null) => void,
  onIceFailure?: () => void,
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.ontrack = onTrack;

  pc.onicecandidate = (event) => {
    onIceCandidate(event.candidate ?? null);
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[webrtc] ICE connection state:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
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
