// ---------------------------------------------------------------------------
// components/NewChatDrawer.tsx -- Bottom sheet for user search + friend requests
// ---------------------------------------------------------------------------

import React from 'react';
import UserSearch from './UserSearch';
import FriendRequests from './FriendRequests';

interface Props {
  open: boolean;
  onClose: () => void;
  onFriendAccepted: () => void;
}

export default function NewChatDrawer({ open, onClose, onFriendAccepted }: Props) {
  if (!open) return null;

  const handleAccepted = () => {
    onFriendAccepted();
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-handle" />
        <div className="drawer-content">
          <h2 className="section-title">Find Users</h2>
          <UserSearch />
          <FriendRequests onAccepted={handleAccepted} />
        </div>
      </div>
    </div>
  );
}
