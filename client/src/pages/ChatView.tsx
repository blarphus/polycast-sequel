// ---------------------------------------------------------------------------
// pages/ChatView.tsx -- DM chat view with real-time messaging
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { socket } from '../socket';
import {
  getMessages,
  getConversations,
  sendMessage,
  markMessagesRead,
  Message,
  Conversation,
} from '../api';

export default function ChatView() {
  const { friendId } = useParams<{ friendId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [friendInfo, setFriendInfo] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [friendOnline, setFriendOnline] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIndicatorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitRef = useRef(0);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load initial data
  useEffect(() => {
    if (!friendId) return;

    let cancelled = false;

    async function load() {
      try {
        const [msgData, convos] = await Promise.all([
          getMessages(friendId!),
          getConversations(),
        ]);

        if (cancelled) return;

        setMessages(msgData.messages);
        setHasMore(msgData.has_more);

        const friend = convos.find((c) => c.friend_id === friendId);
        if (friend) {
          setFriendInfo(friend);
          setFriendOnline(friend.online);
        }

        // Mark as read
        markMessagesRead(friendId!).catch(() => {});
      } catch (err) {
        console.error('Failed to load chat:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [friendId]);

  // Scroll to bottom after initial load
  useEffect(() => {
    if (!loading && messages.length > 0) {
      // Use setTimeout to ensure DOM has rendered
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
    }
  }, [loading]);

  // Socket listeners
  useEffect(() => {
    if (!friendId) return;

    const onNewMessage = (msg: Message) => {
      // Only handle messages in this conversation
      if (msg.sender_id === friendId || msg.receiver_id === friendId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // Auto-read incoming messages
        if (msg.sender_id === friendId) {
          markMessagesRead(friendId).catch(() => {});
        }
        setTimeout(() => scrollToBottom(), 50);
      }
    };

    const onTyping = ({ userId }: { userId: string }) => {
      if (userId === friendId) {
        setTyping(true);
        if (typingIndicatorRef.current) clearTimeout(typingIndicatorRef.current);
        typingIndicatorRef.current = setTimeout(() => setTyping(false), 3000);
      }
    };

    const onRead = ({ userId }: { userId: string }) => {
      if (userId === friendId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.sender_id === String(user?.id) && !m.read_at
              ? { ...m, read_at: new Date().toISOString() }
              : m,
          ),
        );
      }
    };

    const onOnline = ({ userId }: { userId: string }) => {
      if (userId === friendId) setFriendOnline(true);
    };

    const onOffline = ({ userId }: { userId: string }) => {
      if (userId === friendId) setFriendOnline(false);
    };

    socket.on('message:new', onNewMessage);
    socket.on('message:typing', onTyping);
    socket.on('message:read', onRead);
    socket.on('user:online', onOnline);
    socket.on('user:offline', onOffline);

    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('message:typing', onTyping);
      socket.off('message:read', onRead);
      socket.off('user:online', onOnline);
      socket.off('user:offline', onOffline);
      if (typingIndicatorRef.current) clearTimeout(typingIndicatorRef.current);
    };
  }, [friendId, user?.id, scrollToBottom]);

  // Load more (infinite scroll upward)
  const loadMore = useCallback(async () => {
    if (!friendId || !hasMore || loadingMore) return;
    setLoadingMore(true);

    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;

    try {
      const oldest = messages[0];
      const data = await getMessages(friendId, oldest?.id);
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.has_more);

      // Maintain scroll position
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        });
      }
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [friendId, hasMore, loadingMore, messages]);

  // Scroll handler for infinite scroll
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (container.scrollTop < 100 && hasMore && !loadingMore) {
      loadMore();
    }
  }, [hasMore, loadingMore, loadMore]);

  // Send message
  const handleSend = async () => {
    if (!friendId || !input.trim() || sending) return;

    const body = input.trim();
    setInput('');
    setSending(true);

    // Optimistic UI
    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      sender_id: String(user?.id),
      receiver_id: friendId,
      body,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setTimeout(() => scrollToBottom(), 50);

    try {
      const real = await sendMessage(friendId, body);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? real : m)));
    } catch (err) {
      console.error('Failed to send message:', err);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(body); // Restore input
    } finally {
      setSending(false);
    }
  };

  // Typing indicator emit (debounced)
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);

    if (!friendId) return;
    const now = Date.now();
    if (now - lastEmitRef.current > 2000) {
      socket.emit('message:typing', { friendId });
      lastEmitRef.current = now;
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      // Could emit typing:stop if needed
    }, 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Date separator logic
  const getDateLabel = (dateStr: string): string => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today.getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const shouldShowDate = (idx: number): boolean => {
    if (idx === 0) return true;
    const prev = new Date(messages[idx - 1].created_at);
    const curr = new Date(messages[idx].created_at);
    return (
      prev.getFullYear() !== curr.getFullYear() ||
      prev.getMonth() !== curr.getMonth() ||
      prev.getDate() !== curr.getDate()
    );
  };

  const formatTime = (iso: string): string => {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const friendName = friendInfo?.friend_display_name || friendInfo?.friend_username || 'Chat';

  if (loading) {
    return (
      <div className="chat-page">
        <div className="loading-screen">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      {/* Header */}
      <header className="chat-header">
        <button className="chat-back-btn" onClick={() => navigate('/')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="chat-header-info">
          <span className="chat-header-name">{friendName}</span>
          <span className="chat-header-status">
            {friendOnline ? 'online' : 'offline'}
          </span>
        </div>
        <button
          className="chat-call-btn"
          onClick={() => navigate(`/call/${friendId}?role=caller`)}
          title="Video call"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </button>
      </header>

      {/* Messages */}
      <div
        className="chat-messages"
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {loadingMore && (
          <div className="chat-loading-more">
            <div className="loading-spinner" />
          </div>
        )}

        {messages.map((msg, idx) => {
          const isSent = msg.sender_id === String(user?.id);
          return (
            <React.Fragment key={msg.id}>
              {shouldShowDate(idx) && (
                <div className="chat-date-separator">
                  <span>{getDateLabel(msg.created_at)}</span>
                </div>
              )}
              <div className={`chat-bubble ${isSent ? 'sent' : 'received'}`}>
                <p className="chat-bubble-body">{msg.body}</p>
                <span className="chat-bubble-time">
                  {formatTime(msg.created_at)}
                  {isSent && msg.read_at && ' \u2713\u2713'}
                </span>
              </div>
            </React.Fragment>
          );
        })}

        {typing && (
          <div className="chat-typing-indicator">typing...</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="chat-input-bar">
        <input
          className="chat-input"
          type="text"
          placeholder="Message..."
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || sending}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
