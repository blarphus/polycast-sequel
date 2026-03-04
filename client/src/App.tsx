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
import Onboarding from './pages/Onboarding';
import Dictionary from './pages/Dictionary';
import Learn from './pages/Learn';
import Students from './pages/Students';
import StudentDetail from './pages/StudentDetail';
import Classwork from './pages/Classwork';
import Watch from './pages/Watch';
import Browse from './pages/Browse';
import Channel from './pages/Channel';
import Lesson from './pages/Lesson';
import GroupCall from './pages/GroupCall';
import ReadArticle from './pages/ReadArticle';
import IncomingCall from './components/IncomingCall';
import BottomToolbar from './components/BottomToolbar';
import ErrorBoundary from './components/ErrorBoundary';

// ---------------------------------------------------------------------------
// ProtectedRoute -- redirects to /login when the user is not authenticated
// ---------------------------------------------------------------------------

function ProtectedRoute({ children, skipLanguageCheck }: { children: React.ReactNode; skipLanguageCheck?: boolean }) {
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

  if (!skipLanguageCheck && (!user.native_language || !user.target_language)) {
    return <Navigate to="/onboarding" replace />;
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

  const hideToolbar = pathname.startsWith('/chat/') || pathname.startsWith('/call/') || pathname.startsWith('/group-call/');

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

      <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute skipLanguageCheck>
              <Onboarding />
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/browse"
          element={
            <ProtectedRoute>
              <Browse />
            </ProtectedRoute>
          }
        />
        <Route
          path="/channel/:handle"
          element={
            <ProtectedRoute>
              <Channel />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lesson/:id"
          element={
            <ProtectedRoute>
              <Lesson />
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
        <Route
          path="/group-call/:postId"
          element={
            <ProtectedRoute>
              <GroupCall />
            </ProtectedRoute>
          }
        />
        <Route
          path="/read/:lang/:index"
          element={
            <ProtectedRoute>
              <ReadArticle />
            </ProtectedRoute>
          }
        />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
      </DictionaryToastProvider>
    </AuthProvider>
  );
}
