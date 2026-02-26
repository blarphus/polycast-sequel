// ---------------------------------------------------------------------------
// pages/ConversationList.tsx -- WhatsApp-style conversation list (replaces Home)
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { socket } from '../socket';
import { getConversations, Conversation, Message } from '../api';
import { formatRelativeTime } from '../utils/dateFormat';
import NewChatDrawer from '../components/NewChatDrawer';

export default function ConversationList() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [connected, setConnected] = useState(socket.connected);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadConversations = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(data);
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Socket connection badge
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

  // Real-time updates
  useEffect(() => {
    const onNewMessage = (msg: Message) => {
      setConversations((prev) => {
        const friendId = msg.sender_id === user?.id ? msg.receiver_id : msg.sender_id;
        const idx = prev.findIndex((c) => c.friend_id === friendId);
        if (idx === -1) {
          // New conversation from a new friend — reload to get full data
          loadConversations();
          return prev;
        }
        const updated = [...prev];
        const conv = { ...updated[idx] };
        conv.last_message_body = msg.body;
        conv.last_message_at = msg.created_at;
        conv.last_message_sender_id = msg.sender_id;
        if (msg.sender_id !== user?.id) {
          conv.unread_count += 1;
        }
        updated.splice(idx, 1);
        updated.unshift(conv);
        return updated;
      });
    };

    const onOnline = ({ userId }: { userId: string }) => {
      setConversations((prev) =>
        prev.map((c) => (c.friend_id === userId ? { ...c, online: true } : c)),
      );
    };

    const onOffline = ({ userId }: { userId: string }) => {
      setConversations((prev) =>
        prev.map((c) => (c.friend_id === userId ? { ...c, online: false } : c)),
      );
    };

    const onFriendAccepted = () => {
      loadConversations();
    };

    socket.on('message:new', onNewMessage);
    socket.on('user:online', onOnline);
    socket.on('user:offline', onOffline);
    socket.on('friend:accepted', onFriendAccepted);

    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('user:online', onOnline);
      socket.off('user:offline', onOffline);
      socket.off('friend:accepted', onFriendAccepted);
    };
  }, [user?.id, loadConversations]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const getInitials = (name: string | null, username: string): string => {
    const n = name || username;
    const parts = n.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  };

  return (
    <div className="conversations-page">
      <header className="conversations-header">
        <div className="home-header-left">
          <h1 className="home-logo">Polycast</h1>
          <span className={`connection-badge ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="conversations-header-right">
          <button
            className="conversations-icon-btn"
            onClick={() => navigate('/test')}
            title="Test Camera"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </button>
          <button
            className="conversations-icon-btn"
            onClick={() => navigate('/settings')}
            title="Settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            className="conversations-icon-btn"
            onClick={handleLogout}
            title="Logout"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      <div className="conversations-search-bar">
        <svg className="conversations-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="conversations-search-input"
          type="text"
          placeholder="Search for friends..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setDrawerOpen(true)}
        />
      </div>

      <div className="conversations-list">
        {error && (
          <p className="auth-error" style={{ margin: '1rem' }}>Failed to load conversations: {error}</p>
        )}
        {loading ? (
          <p className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>
            Loading conversations...
          </p>
        ) : conversations.length === 0 ? (
          <div className="conversations-empty">
            <p>No conversations yet</p>
            <p className="text-muted">Search above to find friends and start chatting</p>
          </div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.friend_id}
              className="conversation-item"
              onClick={() => navigate(`/chat/${c.friend_id}`)}
            >
              <div className="conversation-avatar">
                <span className="conversation-avatar-initials">
                  {getInitials(c.friend_display_name, c.friend_username)}
                </span>
                {c.online && <span className="conversation-avatar-dot" />}
              </div>
              <div className="conversation-content">
                <span className="conversation-name">
                  {c.friend_display_name || c.friend_username}
                </span>
                <span className="conversation-preview">
                  {c.last_message_body
                    ? (c.last_message_sender_id === user?.id ? 'You: ' : '') + c.last_message_body
                    : 'Start a conversation'}
                </span>
              </div>
              <div className="conversation-meta">
                <span className="conversation-time">{formatRelativeTime(c.last_message_at)}</span>
                {c.unread_count > 0 && (
                  <span className="conversation-unread">{c.unread_count}</span>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      <NewChatDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSearchQuery(''); }}
        onFriendAccepted={loadConversations}
        initialQuery={searchQuery}
      />

    </div>
  );
}
