import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFriends, removeFriend, Friend } from '../api';
import { socket } from '../socket';

export interface FriendsListHandle {
  refresh: () => void;
}

const FriendsList = forwardRef<FriendsListHandle>(function FriendsList(_props, ref) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadFriends = useCallback(async () => {
    try {
      const data = await getFriends();
      setFriends(data);
    } catch (err) {
      console.error('Failed to load friends:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({ refresh: loadFriends }), [loadFriends]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  // Real-time online/offline updates
  useEffect(() => {
    const onOnline = ({ userId }: { userId: string }) => {
      setFriends((prev) => prev.map((f) => String(f.id) === userId ? { ...f, online: true } : f));
    };
    const onOffline = ({ userId }: { userId: string }) => {
      setFriends((prev) => prev.map((f) => String(f.id) === userId ? { ...f, online: false } : f));
    };
    const onAccepted = () => { loadFriends(); };

    socket.on('user:online', onOnline);
    socket.on('user:offline', onOffline);
    socket.on('friend:accepted', onAccepted);

    return () => {
      socket.off('user:online', onOnline);
      socket.off('user:offline', onOffline);
      socket.off('friend:accepted', onAccepted);
    };
  }, [loadFriends]);

  const handleCall = (userId: string) => {
    navigate(`/call/${userId}?role=caller`);
  };

  const handleRemove = async (friendshipId: string) => {
    try {
      await removeFriend(friendshipId);
      setFriends((prev) => prev.filter((f) => f.friendship_id !== friendshipId));
    } catch (err) {
      console.error('Failed to remove friend:', err);
    }
  };

  if (loading) return <p className="text-muted">Loading friends...</p>;
  if (friends.length === 0) {
    return <p className="text-muted">No friends yet. Search for users and send friend requests!</p>;
  }

  return (
    <div className="friends-list">
      {friends.map((f) => (
        <div key={f.friendship_id} className="friends-list-item">
          <div className="friends-list-info">
            <span className={`online-dot ${f.online ? 'online' : 'offline'}`} />
            <div>
              <span className="friends-list-name">{f.display_name || f.username}</span>
              <span className="friends-list-username">@{f.username}</span>
            </div>
          </div>
          <div className="friends-list-actions">
            <button className="btn btn-primary btn-sm" onClick={() => handleCall(f.id)}>
              Call
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleRemove(f.friendship_id)}>
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

export default FriendsList;
