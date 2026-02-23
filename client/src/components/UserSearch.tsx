// ---------------------------------------------------------------------------
// components/UserSearch.tsx -- Search users and initiate calls
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchUsers, UserResult } from '../api';
import { socket } from '../socket';
import { useAuth } from '../hooks/useAuth';

export default function UserSearch() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        // Exclude self from results
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

  const handleCall = useCallback(
    (targetUserId: number) => {
      // Navigate to the call page as the caller
      navigate(`/call/${targetUserId}?role=caller`);
    },
    [navigate],
  );

  return (
    <div className="user-search">
      <div className="user-search-input-wrap">
        <input
          className="form-input user-search-input"
          type="text"
          placeholder="Search by username or display name..."
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
                  <span className="user-search-display">{u.display_name}</span>
                  <span className="user-search-username">@{u.username}</span>
                </div>
              </div>
              {u.online && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleCall(u.id)}
                >
                  Call
                </button>
              )}
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
