// ---------------------------------------------------------------------------
// components/IncomingCall.tsx -- Modal overlay for incoming calls
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';

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

    socket.on('call:incoming', onCallIncoming);

    return () => {
      socket.off('call:incoming', onCallIncoming);
    };
  }, []);

  const handleAccept = useCallback(() => {
    if (!incoming) return;
    // Don't emit call:accept here — let the Call page emit it after
    // the peer connection is created, so the offer doesn't arrive
    // before the callee is ready to handle it.
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
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
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
