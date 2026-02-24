// ---------------------------------------------------------------------------
// pages/Home.tsx -- Main dashboard after login
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { socket } from '../socket';
import { getCallHistory, CallRecord } from '../api';
import UserSearch from '../components/UserSearch';
import FriendRequests from '../components/FriendRequests';
import FriendsList, { FriendsListHandle } from '../components/FriendsList';

export default function Home() {
  const { user, logout } = useAuth();
  const [connected, setConnected] = useState(socket.connected);
  const navigate = useNavigate();

  const friendsRef = useRef<FriendsListHandle>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [callsLoading, setCallsLoading] = useState(true);

  // Track socket connection state for the badge
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCallHistory()
      .then((data) => {
        if (!cancelled) setCalls(data);
      })
      .catch((err) => console.error('Failed to load call history:', err))
      .finally(() => {
        if (!cancelled) setCallsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return 'N/A';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="home-page">
      {/* Header */}
      <header className="home-header">
        <div className="home-header-left">
          <h1 className="home-logo">Polycast</h1>
          <span className={`connection-badge ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="home-header-right">
          <span className="home-greeting">Hello, {user?.display_name}</span>
          <button className="btn btn-secondary" onClick={() => navigate('/test')}>
            Test Camera
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
            Settings
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/dictionary')}>
            Dictionary
          </button>
          <button className="btn btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="home-main">
        {/* Search section */}
        <section className="home-section">
          <h2 className="section-title">Find Users</h2>
          <UserSearch />
        </section>

        {/* Friend requests (only renders if there are pending requests) */}
        <FriendRequests onAccepted={() => friendsRef.current?.refresh()} />

        {/* Friends list */}
        <section className="home-section">
          <h2 className="section-title">Friends</h2>
          <FriendsList ref={friendsRef} />
        </section>

        {/* Call history */}
        <section className="home-section">
          <h2 className="section-title">Call History</h2>
          {callsLoading ? (
            <p className="text-muted">Loading call history...</p>
          ) : calls.length === 0 ? (
            <p className="text-muted">No calls yet. Search for a user to start a call.</p>
          ) : (
            <div className="call-history-list">
              {calls.map((call) => {
                const isCaller = call.caller_id === user?.id;
                const otherName = isCaller
                  ? call.callee_display_name
                  : call.caller_display_name;
                const otherUsername = isCaller
                  ? call.callee_username
                  : call.caller_username;

                return (
                  <div key={call.id} className="call-history-item">
                    <div className="call-history-info">
                      <span className="call-history-name">{otherName}</span>
                      <span className="call-history-username">@{otherUsername}</span>
                    </div>
                    <div className="call-history-meta">
                      <span className="call-history-direction">
                        {isCaller ? 'Outgoing' : 'Incoming'}
                      </span>
                      <span className="call-history-duration">
                        {formatDuration(call.duration_seconds)}
                      </span>
                      <span className="call-history-date">
                        {formatDate(call.started_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
