// ---------------------------------------------------------------------------
// App.tsx -- Root component with auth, routing, and global incoming-call modal
// ---------------------------------------------------------------------------

import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { DictionaryToastProvider } from './hooks/useDictionaryToast';
import { useSocket } from './hooks/useSocket';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Home from './pages/Home';
import ConversationList from './pages/ConversationList';
import ChatView from './pages/ChatView';
import Call from './pages/Call';
import Test from './pages/Test';
import Settings from './pages/Settings';
import Dictionary from './pages/Dictionary';
import Learn from './pages/Learn';
import Students from './pages/Students';
import StudentDetail from './pages/StudentDetail';
import Classwork from './pages/Classwork';
import Watch from './pages/Watch';
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

  const hideToolbar = pathname.startsWith('/chat/') || pathname.startsWith('/call/');

  useEffect(() => {
    if (!user) return;
    document.documentElement.classList.toggle('sidebar-visible', !hideToolbar);
    return () => document.documentElement.classList.remove('sidebar-visible');
  }, [user, hideToolbar]);

  if (!user) return null;

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
      <DictionaryToastProvider>
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
          path="/chats"
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
        <Route
          path="/students"
          element={
            <ProtectedRoute>
              <Students />
            </ProtectedRoute>
          }
        />
        <Route
          path="/students/:studentId"
          element={
            <ProtectedRoute>
              <StudentDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/classwork"
          element={
            <ProtectedRoute>
              <Classwork />
            </ProtectedRoute>
          }
        />
        <Route
          path="/watch/:id"
          element={
            <ProtectedRoute>
              <Watch />
            </ProtectedRoute>
          }
        />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </DictionaryToastProvider>
    </AuthProvider>
  );
}
