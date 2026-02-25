import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchUsers, UserResult, getFriends, getPendingRequests, sendFriendRequest, Friend, FriendRequest } from '../api';
import { socket } from '../socket';
import { useAuth } from '../hooks/useAuth';

export default function UserSearch() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Track friendship states: userId -> 'friend' | 'pending_sent' | 'pending_received'
  const [friendMap, setFriendMap] = useState<Record<string, string>>({});
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing friendships to populate status labels
  useEffect(() => {
    let cancelled = false;
    Promise.all([getFriends(), getPendingRequests()])
      .then(([friends, requests]: [Friend[], FriendRequest[]]) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const f of friends) {
          map[String(f.id)] = 'friend';
        }
        for (const r of requests) {
          map[String(r.requester_id)] = 'pending_received';
        }
        setFriendMap(map);
      })
      .catch((err) => console.error('Failed to load friendship data:', err));
    return () => { cancelled = true; };
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchUsers(trimmed);
        setResults(data.filter((u) => u.id !== user?.id));
        setError('');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, user?.id]);

  // Listen for real-time online/offline events to update results
  useEffect(() => {
    const onUserOnline = ({ userId }: { userId: string }) => {
      setResults((prev) =>
        prev.map((u) => (String(u.id) === userId ? { ...u, online: true } : u)),
      );
    };
    const onUserOffline = ({ userId }: { userId: string }) => {
      setResults((prev) =>
        prev.map((u) => (String(u.id) === userId ? { ...u, online: false } : u)),
      );
    };

    socket.on('user:online', onUserOnline);
    socket.on('user:offline', onUserOffline);

    return () => {
      socket.off('user:online', onUserOnline);
      socket.off('user:offline', onUserOffline);
    };
  }, []);

  const handleCall = useCallback(
    (targetUserId: string) => {
      navigate(`/call/${targetUserId}?role=caller`);
    },
    [navigate],
  );

  const handleAddFriend = async (userId: string) => {
    setSendingTo(userId);
    try {
      await sendFriendRequest(userId);
      setFriendMap((prev) => ({ ...prev, [userId]: 'pending_sent' }));
    } catch (err) {
      console.error('Failed to send friend request:', err);
    } finally {
      setSendingTo(null);
    }
  };

  const renderFriendButton = (u: UserResult) => {
    const uid = u.id;
    const status = friendMap[uid];

    if (status === 'friend' || status === 'pending_sent' || status === 'pending_received') {
      return (
        <span className="btn btn-sm btn-secondary" style={{ opacity: 0.6, cursor: 'default' }}>
          {status === 'friend' ? 'Friends' : 'Pending'}
        </span>
      );
    }

    return (
      <button
        className="btn btn-sm btn-secondary"
        disabled={sendingTo === uid}
        onClick={() => handleAddFriend(u.id)}
      >
        Add Friend
      </button>
    );
  };

  return (
    <div className="user-search">
      <div className="user-search-input-wrap">
        <input
          className="form-input user-search-input"
          type="text"
          placeholder="Search by username..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && <span className="user-search-spinner" />}
      </div>

      {error && <p className="user-search-error">{error}</p>}

      {results.length > 0 && (
        <ul className="user-search-results">
          {results.map((u) => (
            <li key={u.id} className="user-search-item">
              <div className="user-search-info">
                <span className={`online-dot ${u.online ? 'online' : 'offline'}`} />
                <div>
                  <span className="user-search-display">
                    {u.display_name || u.username}
                  </span>
                  <span className="user-search-username">@{u.username}</span>
                </div>
              </div>
              <div className="user-search-actions">
                {renderFriendButton(u)}
                <button
                  className={`btn btn-sm ${u.online ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleCall(u.id)}
                >
                  Call
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {query.trim() && !loading && results.length === 0 && !error && (
        <p className="text-muted user-search-empty">No users found.</p>
      )}
    </div>
  );
}
