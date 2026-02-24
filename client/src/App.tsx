// ---------------------------------------------------------------------------
// App.tsx -- Root component with auth, routing, and global incoming-call modal
// ---------------------------------------------------------------------------

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useSocket } from './hooks/useSocket';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Home from './pages/Home';
import Call from './pages/Call';
import Test from './pages/Test';
import Settings from './pages/Settings';
import Dictionary from './pages/Dictionary';
import IncomingCall from './components/IncomingCall';

// ---------------------------------------------------------------------------
// ProtectedRoute -- redirects to /login when the user is not authenticated
// ---------------------------------------------------------------------------

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// AuthenticatedShell -- renders the IncomingCall modal globally, but only
// when the user is logged in (so we don't listen for socket events on the
// login/signup pages).
// ---------------------------------------------------------------------------

function AuthenticatedShell() {
  const { user } = useAuth();
  useSocket(); // Keep socket connected for ALL authenticated pages
  if (!user) return null;
  return <IncomingCall />;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <AuthProvider>
      {/* Global incoming-call modal (only when authenticated) */}
      <AuthenticatedShell />

      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/call/:peerId"
          element={
            <ProtectedRoute>
              <Call />
            </ProtectedRoute>
          }
        />
        <Route
          path="/test"
          element={
            <ProtectedRoute>
              <Test />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dictionary"
          element={
            <ProtectedRoute>
              <Dictionary />
            </ProtectedRoute>
          }
        />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
