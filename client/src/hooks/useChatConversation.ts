import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getFriends, getMessages, markMessagesRead, sendMessage } from '../api';
import type { Friend, Message } from '../api';
import { socket } from '../socket';

interface UseChatConversationOptions {
  friendId?: string;
  userId?: string;
}

export function useChatConversation({ friendId, userId }: UseChatConversationOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [friendInfo, setFriendInfo] = useState<Friend | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [friendOnline, setFriendOnline] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIndicatorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitRef = useRef(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (!friendId) return;

    setMessages([]);
    setHasMore(false);
    setLoading(true);

    let cancelled = false;

    async function load() {
      try {
        const [msgData, friends] = await Promise.all([
          getMessages(friendId),
          getFriends(),
        ]);

        if (cancelled) return;

        setMessages(msgData.messages);
        setHasMore(msgData.has_more);

        const friend = friends.find((candidate) => candidate.id === friendId);
        if (friend) {
          setFriendInfo(friend);
          setFriendOnline(friend.online);
        }

        markMessagesRead(friendId).catch((err) => console.error('Failed to mark messages read:', err));
      } catch (err) {
        console.error('Failed to load chat:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [friendId]);

  useEffect(() => {
    if (!loading && messages.length > 0) {
      setTimeout(() => scrollToBottom('auto'), 50);
    }
  }, [loading, messages.length, scrollToBottom]);

  useEffect(() => {
    if (!friendId) return;

    const onNewMessage = (msg: Message) => {
      if (msg.sender_id === friendId || msg.receiver_id === friendId) {
        setMessages((prev) => {
          if (prev.some((existing) => existing.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (msg.sender_id === friendId) {
          markMessagesRead(friendId).catch((err) => console.error('Failed to mark messages read:', err));
        }
        setTimeout(() => scrollToBottom(), 50);
      }
    };

    const onTyping = ({ userId: typingUserId }: { userId: string }) => {
      if (typingUserId === friendId) {
        setTyping(true);
        if (typingIndicatorRef.current) clearTimeout(typingIndicatorRef.current);
        typingIndicatorRef.current = setTimeout(() => setTyping(false), 3000);
      }
    };

    const onRead = ({ userId: readingUserId }: { userId: string }) => {
      if (readingUserId === friendId) {
        setMessages((prev) =>
          prev.map((message) =>
            message.sender_id === userId && !message.read_at
              ? { ...message, read_at: new Date().toISOString() }
              : message,
          ),
        );
      }
    };

    const onOnline = ({ userId: onlineUserId }: { userId: string }) => {
      if (onlineUserId === friendId) setFriendOnline(true);
    };

    const onOffline = ({ userId: offlineUserId }: { userId: string }) => {
      if (offlineUserId === friendId) setFriendOnline(false);
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
  }, [friendId, scrollToBottom, userId]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

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

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (container.scrollTop < 100 && hasMore && !loadingMore) {
      loadMore();
    }
  }, [hasMore, loadMore, loadingMore]);

  const handleSend = useCallback(async () => {
    if (!friendId || !input.trim() || sending || !userId) return;

    const body = input.trim();
    setInput('');
    setSending(true);

    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      sender_id: userId,
      receiver_id: friendId,
      body,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setTimeout(() => scrollToBottom(), 50);

    try {
      const real = await sendMessage(friendId, body);
      setMessages((prev) => prev.map((message) => (message.id === tempId ? real : message)));
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages((prev) => prev.filter((message) => message.id !== tempId));
      setInput(body);
    } finally {
      setSending(false);
    }
  }, [friendId, input, scrollToBottom, sending, userId]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [friendId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return {
    friendInfo,
    friendOnline,
    handleInputChange,
    handleKeyDown,
    handleScroll,
    handleSend,
    input,
    loading,
    loadingMore,
    messages,
    messagesContainerRef,
    messagesEndRef,
    sending,
    typing,
  };
}
