import React, { useState, useEffect, useCallback } from 'react';
import { getPendingRequests, acceptFriendRequest, rejectFriendRequest, FriendRequest } from '../api';
import { socket } from '../socket';

interface Props {
  onAccepted?: () => void;
}

export default function FriendRequests({ onAccepted }: Props) {
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const data = await getPendingRequests();
      setRequests(data);
    } catch (err) {
      console.error('Failed to load friend requests:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Listen for new incoming requests in real time
  useEffect(() => {
    const onNewRequest = (data: FriendRequest) => {
      setRequests((prev) => {
        if (prev.some((r) => r.id === data.id)) return prev;
        return [data, ...prev];
      });
    };

    socket.on('friend:request', onNewRequest);
    return () => { socket.off('friend:request', onNewRequest); };
  }, []);

  const handleAccept = async (id: string) => {
    setBusy(id);
    try {
      await acceptFriendRequest(id);
      setRequests((prev) => prev.filter((r) => r.id !== id));
      onAccepted?.();
    } catch (err) {
      console.error('Failed to accept request:', err);
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusy(id);
    try {
      await rejectFriendRequest(id);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('Failed to reject request:', err);
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;
  if (requests.length === 0) return null;

  return (
    <section className="home-section">
      <h2 className="section-title">Friend Requests</h2>
      {error && <p className="auth-error">Failed to load requests: {error}</p>}
      {actionError && <p className="auth-error">{actionError}</p>}
      <div className="friend-requests-list">
        {requests.map((r) => (
          <div key={r.id} className="friend-request-item">
            <div className="friend-request-info">
              <span className="friend-request-name">{r.display_name || r.username}</span>
              <span className="friend-request-username">@{r.username}</span>
            </div>
            <div className="friend-request-actions">
              <button
                className="btn btn-sm btn-primary"
                disabled={busy === r.id}
                onClick={() => handleAccept(r.id)}
              >
                Accept
              </button>
              <button
                className="btn btn-sm btn-secondary"
                disabled={busy === r.id}
                onClick={() => handleReject(r.id)}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
