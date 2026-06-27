// ---------------------------------------------------------------------------
// components/IncomingCall.tsx -- Modal overlay for incoming calls
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { PhoneIcon } from './icons';
import { startRinging, stopRinging } from '../utils/sounds';

interface IncomingCallData {
  callId: string;
  callerId: string;
  callerUsername: string;
  callerDisplayName: string;
  mode?: 'audio' | 'video';
}

export default function IncomingCall() {
  const [incoming, setIncoming] = useState<IncomingCallData | null>(null);
  const navigate = useNavigate();

  // Start / stop ringing sound when incoming call state changes
  useEffect(() => {
    if (incoming) {
      startRinging();
    } else {
      stopRinging();
    }
    return () => stopRinging();
  }, [incoming]);

  useEffect(() => {
    const onCallIncoming = (data: IncomingCallData) => {
      setIncoming(data);
    };

    // Dismiss modal if the caller hangs up before we accept
    const onCallEnded = ({ userId, callId }: { userId?: string; callId?: string }) => {
      setIncoming((prev) => (prev && (prev.callId === callId || prev.callerId === userId) ? null : prev));
    };

    socket.on('call:incoming', onCallIncoming);
    socket.on('call:ended', onCallEnded);
    socket.on('call:cancelled', onCallEnded);

    return () => {
      socket.off('call:incoming', onCallIncoming);
      socket.off('call:ended', onCallEnded);
      socket.off('call:cancelled', onCallEnded);
    };
  }, []);

  const handleAccept = useCallback(() => {
    if (!incoming) return;
    // Emit call:accept immediately so the caller knows we accepted
    // (don't wait for getUserMedia/PC setup on the Call page).
    // The Call page will buffer the incoming offer until its PC is ready.
    socket.emit('call:accept', { callId: incoming.callId, callerId: incoming.callerId });
    const params = new URLSearchParams({
      role: 'callee',
      callId: incoming.callId,
      name: incoming.callerDisplayName || incoming.callerUsername,
    });
    navigate(`/call/${incoming.callerId}?${params.toString()}`);
    setIncoming(null);
  }, [incoming, navigate]);

  const handleReject = useCallback(() => {
    if (!incoming) return;
    socket.emit('call:reject', { callId: incoming.callId, callerId: incoming.callerId });
    setIncoming(null);
  }, [incoming]);

  if (!incoming) return null;

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-modal">
        <div className="incoming-call-icon">
          <PhoneIcon size={48} />
        </div>
        <h2 className="incoming-call-title">Incoming {incoming.mode === 'audio' ? 'Audio' : 'Video'} Call</h2>
        <p className="incoming-call-caller">
          {incoming.callerDisplayName || incoming.callerUsername}
        </p>
        <p className="incoming-call-username">@{incoming.callerUsername}</p>

        <div className="incoming-call-actions">
          <button className="btn btn-accept" onClick={handleAccept}>
            Accept
          </button>
          <button className="btn btn-reject" onClick={handleReject}>
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
