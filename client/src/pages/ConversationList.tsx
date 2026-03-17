// ---------------------------------------------------------------------------
// pages/ConversationList.tsx -- WhatsApp-style conversation list (replaces Home)
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { socket } from '../socket';
import { getConversations, Conversation, Message } from '../api';
import { formatRelativeTime } from '../utils/dateFormat';
import NewChatDrawer from '../components/NewChatDrawer';
import { VideoIcon, LogoutIcon, SearchIcon } from '../components/icons';
import { toErrorMessage } from '../utils/errors';

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
      setError(toErrorMessage(err));
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
            <VideoIcon size={20} />
          </button>
          <button
            className="conversations-icon-btn"
            onClick={handleLogout}
            title="Logout"
          >
            <LogoutIcon size={20} />
          </button>
        </div>
      </header>

      <div className="conversations-search-bar">
        <SearchIcon size={16} className="conversations-search-icon" />
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
