// ---------------------------------------------------------------------------
// pages/Login.tsx
// ---------------------------------------------------------------------------

import React, { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-title">Polycast</h1>
        <p className="auth-subtitle">Sign in to your account</p>

        {error && <div className="auth-error">{error}</div>}

        <label className="form-label" htmlFor="login-username">
          Username
        </label>
        <input
          id="login-username"
          className="form-input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          autoFocus
        />

        <label className="form-label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className="form-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />

        <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign In'}
        </button>

        <p className="auth-link">
          Don&apos;t have an account? <Link to="/signup">Create one</Link>
        </p>
      </form>
    </div>
  );
}
