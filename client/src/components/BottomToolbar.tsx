// ---------------------------------------------------------------------------
// components/BottomToolbar.tsx -- Bottom navigation bar (Dictionary + Video)
// ---------------------------------------------------------------------------

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function BottomToolbar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isDictionary = location.pathname === '/dictionary';
  const isVideo = location.pathname === '/';

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
        className={`toolbar-tab toolbar-tab--purple${isVideo ? ' active' : ''}`}
        onClick={() => navigate('/')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
        <span className="toolbar-label">Video</span>
      </button>
    </nav>
  );
}
