import React from 'react';
import { VideoIcon } from '../icons';

interface ChatHeaderProps {
  friendName?: string;
  friendOnline: boolean;
  onBack: () => void;
  onCall: () => void;
}

export default function ChatHeader({
  friendName,
  friendOnline,
  onBack,
  onCall,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <button className="chat-back-btn" onClick={onBack}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div className="chat-header-info">
        <span className="chat-header-name">{friendName}</span>
        <span className="chat-header-status">
          {friendOnline ? 'online' : 'offline'}
        </span>
      </div>
      <button
        className="chat-call-btn"
        onClick={onCall}
        title="Video call"
      >
        <VideoIcon size={22} />
      </button>
    </header>
  );
}
