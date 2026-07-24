// ---------------------------------------------------------------------------
// App.tsx -- Root component with auth, routing, and global incoming-call modal
// ---------------------------------------------------------------------------

import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { DictionaryToastProvider } from './hooks/useDictionaryToast';
import { useSocket } from './hooks/useSocket';
import IncomingCall from './components/IncomingCall';
import PhraseTranslator from './components/PhraseTranslator';
import BottomToolbar from './components/BottomToolbar';
import ErrorBoundary from './components/ErrorBoundary';
import FallbackToast from './components/FallbackToast';
import DailyGoalCelebration from './components/DailyGoalCelebration';
import { CallProvider } from './contexts/CallProvider';
import { GroupCallProvider } from './contexts/GroupCallProvider';
import FloatingCallTile from './components/FloatingCallTile';
import FloatingGroupCallTile from './components/FloatingGroupCallTile';
import { uiLanguage } from './i18n';
import { emitFallbackDiagnostic } from './utils/fallbackDiagnostics';

let flashcardPreloadModule: Promise<typeof import('./utils/flashcardPreload')> | null = null;

function loadFlashcardPreloader() {
  flashcardPreloadModule ??= import('./utils/flashcardPreload');
  return flashcardPreloadModule;
}

const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const Home = lazy(() => import('./pages/Home'));
const ConversationList = lazy(() => import('./pages/ConversationList'));
const ChatView = lazy(() => import('./pages/ChatView'));
const Call = lazy(() => import('./pages/Call'));
const Test = lazy(() => import('./pages/Test'));
const Settings = lazy(() => import('./pages/Settings'));
const CatalogProgress = lazy(() => import('./pages/CatalogProgress'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Dictionary = lazy(() => import('./pages/Dictionary'));
const Learn = lazy(() => import('./pages/Learn'));
const LearnPreview = lazy(() => import('./pages/LearnPreview'));
const Students = lazy(() => import('./pages/Students'));
const StudentDetail = lazy(() => import('./pages/StudentDetail'));
const Classwork = lazy(() => import('./pages/Classwork'));
const Classes = lazy(() => import('./pages/Classes'));
const Watch = lazy(() => import('./pages/Watch'));
const Browse = lazy(() => import('./pages/Browse'));
const Channel = lazy(() => import('./pages/Channel'));
const Lesson = lazy(() => import('./pages/Lesson'));
const Lessons = lazy(() => import('./pages/Lessons'));
const GroupCall = lazy(() => import('./pages/GroupCall'));
const ReadArticle = lazy(() => import('./pages/ReadArticle'));
const NewsCollection = lazy(() => import('./pages/collections/NewsCollection'));
const Practice = lazy(() => import('./pages/Practice'));
const Calendar = lazy(() => import('./pages/Calendar'));
const DrillPicker = lazy(() => import('./pages/DrillPicker'));
const VoicePractice = lazy(() => import('./pages/VoicePractice'));
const LocalVideos = lazy(() => import('./pages/LocalVideos'));
const LocalWatch = lazy(() => import('./pages/LocalWatch'));
const Library = lazy(() => import('./pages/Library'));
const Reader = lazy(() => import('./pages/Reader'));

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

function StudentRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.account_type === 'teacher') return <Navigate to="/classes" replace />;
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user?.account_type === 'teacher' ? '/classes' : '/learn'} replace />;
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

  const hideToolbar = pathname.startsWith('/chat/') ||
    pathname.startsWith('/call/') ||
    pathname.startsWith('/group-call/') ||
    pathname.startsWith('/books/');

  useEffect(() => {
    if (!user) return;
    document.documentElement.classList.toggle('sidebar-visible', !hideToolbar);
    document.documentElement.lang = uiLanguage(user.native_language);
    return () => document.documentElement.classList.remove('sidebar-visible');
  }, [user, hideToolbar]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      if (flashcardPreloadModule) {
        void flashcardPreloadModule.then(({ resetFlashcardPreload }) => resetFlashcardPreload());
      }
      return undefined;
    }

    // Warm the route bundle, due-card response, and next-card audio shortly
    // after authentication so clicking Flashcards reuses work already done.
    const timer = window.setTimeout(() => {
      void Promise.all([
        import('./pages/Learn'),
        loadFlashcardPreloader().then(({ prefetchFlashcards }) => prefetchFlashcards(userId)),
      ])
        .catch((error) => {
          emitFallbackDiagnostic({
            code: 'flashcard_route_background_preload_fallback',
            severity: 'warning',
            title: 'Flashcards background loading unavailable',
            message: 'Polycast could not finish loading Flashcards in the background, so the page will load normally when opened.',
            detail: error instanceof Error ? error.message : String(error),
          }, { source: 'web.app-shell', operation: 'preload-flashcards' });
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [user?.id]);

  if (!user) return null;

  return (
    <>
      <IncomingCall />
      <PhraseTranslator />
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
      <CallProvider>
      <GroupCallProvider>
      {/* Global incoming-call modal (only when authenticated) */}
      <AuthenticatedShell />
      <FallbackToast />
      <DailyGoalCelebration />
      {/* Mini call tile while a 1:1 call is active off the call page */}
      <FloatingCallTile />
      <FloatingGroupCallTile />

      <ErrorBoundary>
      <Suspense fallback={<div className="loading-screen"><div className="loading-spinner" /></div>}>
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
              <RootRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/home"
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
          path="/lessons"
          element={
            <ProtectedRoute>
              <Lessons />
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
          path="/catalog-progress"
          element={
            <ProtectedRoute>
              <CatalogProgress />
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
          path="/books"
          element={
            <ProtectedRoute>
              <Library />
            </ProtectedRoute>
          }
        />
        <Route
          path="/books/:bookId"
          element={
            <ProtectedRoute>
              <Reader />
            </ProtectedRoute>
          }
        />
        <Route
          path="/learn/preview"
          element={
            <StudentRoute>
              <LearnPreview />
            </StudentRoute>
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
          path="/classes"
          element={
            <ProtectedRoute>
              <Classes />
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
          path="/news"
          element={
            <ProtectedRoute>
              <NewsCollection />
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
        <Route
          path="/calendar"
          element={
            <StudentRoute>
              <Calendar />
            </StudentRoute>
          }
        />
        <Route
          path="/practice"
          element={
            <StudentRoute>
              <Practice />
            </StudentRoute>
          }
        />
        <Route
          path="/practice/drill"
          element={
            <StudentRoute>
              <DrillPicker />
            </StudentRoute>
          }
        />
        <Route
          path="/practice/voice"
          element={
            <StudentRoute>
              <VoicePractice />
            </StudentRoute>
          }
        />
        <Route
          path="/practice/:videoId"
          element={
            <StudentRoute>
              <Practice />
            </StudentRoute>
          }
        />
        <Route
          path="/local-videos"
          element={
            <ProtectedRoute>
              <LocalVideos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/local-watch/:filename"
          element={
            <ProtectedRoute>
              <LocalWatch />
            </ProtectedRoute>
          }
        />
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
      </GroupCallProvider>
      </CallProvider>
      </DictionaryToastProvider>
    </AuthProvider>
  );
}
