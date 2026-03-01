// ---------------------------------------------------------------------------
// components/IncomingCall.tsx -- Modal overlay for incoming calls
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { PhoneIcon } from './icons';

interface IncomingCallData {
  callerId: string;
  callerUsername: string;
  callerDisplayName: string;
}

export default function IncomingCall() {
  const [incoming, setIncoming] = useState<IncomingCallData | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onCallIncoming = (data: IncomingCallData) => {
      setIncoming(data);
    };

    // Dismiss modal if the caller hangs up before we accept
    const onCallEnded = ({ userId }: { userId: string }) => {
      setIncoming((prev) => (prev && prev.callerId === userId ? null : prev));
    };

    socket.on('call:incoming', onCallIncoming);
    socket.on('call:ended', onCallEnded);

    return () => {
      socket.off('call:incoming', onCallIncoming);
      socket.off('call:ended', onCallEnded);
    };
  }, []);

  const handleAccept = useCallback(() => {
    if (!incoming) return;
    // Emit call:accept immediately so the caller knows we accepted
    // (don't wait for getUserMedia/PC setup on the Call page).
    // The Call page will buffer the incoming offer until its PC is ready.
    socket.emit('call:accept', { callerId: incoming.callerId });
    navigate(`/call/${incoming.callerId}?role=callee`);
    setIncoming(null);
  }, [incoming, navigate]);

  const handleReject = useCallback(() => {
    if (!incoming) return;
    socket.emit('call:reject', { callerId: incoming.callerId });
    setIncoming(null);
  }, [incoming]);

  if (!incoming) return null;

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-modal">
        <div className="incoming-call-icon">
          <PhoneIcon size={48} />
        </div>
        <h2 className="incoming-call-title">Incoming Call</h2>
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
