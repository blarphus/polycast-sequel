// ---------------------------------------------------------------------------
// App.tsx -- Root component with auth, routing, and global incoming-call modal
// ---------------------------------------------------------------------------

import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useSocket } from './hooks/useSocket';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ConversationList from './pages/ConversationList';
import ChatView from './pages/ChatView';
import Call from './pages/Call';
import Test from './pages/Test';
import Settings from './pages/Settings';
import Dictionary from './pages/Dictionary';
import Learn from './pages/Learn';
import IncomingCall from './components/IncomingCall';
import BottomToolbar from './components/BottomToolbar';

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
  const { pathname } = useLocation();
  useSocket(); // Keep socket connected for ALL authenticated pages
  if (!user) return null;

  const hideToolbar = pathname.startsWith('/chat/') || pathname.startsWith('/call/');

  return (
    <>
      <IncomingCall />
      {!hideToolbar && <BottomToolbar />}
    </>
  );
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
              <ConversationList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat/:friendId"
          element={
            <ProtectedRoute>
              <ChatView />
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
        <Route
          path="/learn"
          element={
            <ProtectedRoute>
              <Learn />
            </ProtectedRoute>
          }
        />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
