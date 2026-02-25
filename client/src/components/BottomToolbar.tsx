// ---------------------------------------------------------------------------
// components/BottomToolbar.tsx -- Bottom navigation bar (Dictionary + Chats)
// ---------------------------------------------------------------------------

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function BottomToolbar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isDictionary = location.pathname === '/dictionary';
  const isChats = location.pathname === '/';

  return (
    <nav className="bottom-toolbar">
      <button
        className={`toolbar-tab toolbar-tab--red${isDictionary ? ' active' : ''}`}
        onClick={() => navigate('/dictionary')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span className="toolbar-label">Dictionary</span>
      </button>
      <button
        className={`toolbar-tab toolbar-tab--purple${isChats ? ' active' : ''}`}
        onClick={() => navigate('/')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="toolbar-label">Chats</span>
      </button>
    </nav>
  );
}
