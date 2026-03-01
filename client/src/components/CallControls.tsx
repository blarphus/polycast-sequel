// ---------------------------------------------------------------------------
// components/CallControls.tsx -- Shared Zoom-style call control bar
// ---------------------------------------------------------------------------

import React, { ReactNode } from 'react';
import {
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  MonitorIcon,
  MonitorStopIcon,
} from './icons';

export { PhoneOffIcon } from './icons';

// ---- Component ------------------------------------------------------------

interface CallControlsProps {
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  primaryAction: {
    label: string;
    icon: ReactNode;
    onClick: () => void;
    variant: 'danger' | 'secondary';
  };
}

export default function CallControls({
  isMuted,
  isCameraOff,
  isScreenSharing,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  primaryAction,
}: CallControlsProps) {
  return (
    <div className="call-controls-bar">
      <button
        className={`call-control-btn${isMuted ? ' active' : ''}`}
        onClick={onToggleMute}
        title={isMuted ? 'Unmute' : 'Mute'}
      >
        {isMuted ? <MicOffIcon /> : <MicIcon />}
      </button>

      <button
        className={`call-control-btn${isCameraOff ? ' active' : ''}`}
        onClick={onToggleCamera}
        title={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
      >
        {isCameraOff ? <VideoOffIcon /> : <VideoIcon />}
      </button>

      <button
        className={`call-control-btn${isScreenSharing ? ' sharing' : ''}`}
        onClick={onToggleScreenShare}
        title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
      >
        {isScreenSharing ? <MonitorStopIcon /> : <MonitorIcon />}
      </button>

      <button
        className={`call-control-btn--${primaryAction.variant}`}
        onClick={primaryAction.onClick}
        title={primaryAction.label}
      >
        {primaryAction.icon}
      </button>
    </div>
  );
}
