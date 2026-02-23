// ---------------------------------------------------------------------------
// pages/Signup.tsx
// ---------------------------------------------------------------------------

import React, { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signup(username, password, displayName);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-title">Polycast</h1>
        <p className="auth-subtitle">Create a new account</p>

        {error && <div className="auth-error">{error}</div>}

        <label className="form-label" htmlFor="signup-username">
          Username
        </label>
        <input
          id="signup-username"
          className="form-input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          autoFocus
        />

        <label className="form-label" htmlFor="signup-display-name">
          Display Name
        </label>
        <input
          id="signup-display-name"
          className="form-input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />

        <label className="form-label" htmlFor="signup-password">
          Password
        </label>
        <input
          id="signup-password"
          className="form-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          minLength={6}
        />

        <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
          {submitting ? 'Creating account...' : 'Create Account'}
        </button>

        <p className="auth-link">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
