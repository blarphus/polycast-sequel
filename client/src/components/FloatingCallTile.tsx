// ---------------------------------------------------------------------------
// components/FloatingCallTile.tsx -- Draggable mini video tile shown while a
// 1:1 call is active and the user is on any page other than the call page.
// Carries the remote audio (the call page's video is unmounted off-page).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useActiveCall } from '../contexts/CallProvider';
import { MicIcon, MicOffIcon, PhoneOffIcon, ExpandIcon, PipIcon } from './icons';

const TILE_MARGIN = 12;

export default function FloatingCallTile() {
  const {
    active,
    callEnded,
    peerId,
    role,
    callId,
    displayName,
    remoteStream,
    remoteHasVideo,
    isMuted,
    toggleMute,
    endCall,
  } = useActiveCall();
  const location = useLocation();
  const navigate = useNavigate();

  const tileRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  // null = default bottom-right CSS position; set once the user drags.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const onCallPage = location.pathname.startsWith('/call/');
  const visible = active && !callEnded && !onCallPage;

  // Attach the remote stream whenever the tile is showing.
  useEffect(() => {
    if (!visible) return;
    if (videoRef.current) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [visible, remoteStream]);

  // Reset the dragged position when the call goes away.
  useEffect(() => {
    if (!active) setPos(null);
  }, [active]);

  if (!visible || !peerId || !role) return null;

  const clamp = (x: number, y: number) => {
    const rect = tileRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 240;
    const height = rect?.height ?? 180;
    return {
      x: Math.min(Math.max(x, TILE_MARGIN), window.innerWidth - width - TILE_MARGIN),
      y: Math.min(Math.max(y, TILE_MARGIN), window.innerHeight - height - TILE_MARGIN),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return; // don't drag from buttons
    const rect = tileRef.current!.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
    };
    tileRef.current!.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    drag.moved = true;
    setPos(clamp(e.clientX - drag.offsetX, e.clientY - drag.offsetY));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    tileRef.current?.releasePointerCapture(e.pointerId);
    const wasClick = !drag.moved;
    dragRef.current = null;
    if (wasClick && !(e.target as HTMLElement).closest('button')) {
      expand();
    }
  };

  const expand = () => {
    const params = new URLSearchParams({ role, name: displayName });
    if (callId) params.set('callId', callId);
    navigate(`/call/${peerId}?${params.toString()}`);
  };

  const openNativePip = () => {
    if (!('pictureInPictureEnabled' in document) || !document.pictureInPictureEnabled) {
      console.error('[call] Picture-in-Picture is not supported in this browser');
      return;
    }
    const el = videoRef.current;
    if (!el) return;
    el.requestPictureInPicture().catch((err) => {
      console.error('[call] requestPictureInPicture failed:', err);
    });
  };

  return (
    <div
      ref={tileRef}
      className="floating-call-tile"
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title="Return to call"
    >
      <div className="floating-call-video-wrap">
        <video
          ref={videoRef}
          className="floating-call-video"
          autoPlay
          playsInline
        />
        {!remoteHasVideo && (
          <div className="floating-call-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
        )}
      </div>
      <div className="floating-call-footer">
        <span className="floating-call-name">{displayName}</span>
        <div className="floating-call-actions">
          <button
            type="button"
            className={`floating-call-btn${isMuted ? ' is-active' : ''}`}
            onClick={toggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
          </button>
          <button
            type="button"
            className="floating-call-btn"
            onClick={openNativePip}
            title="Picture in picture"
            aria-label="Picture in picture"
          >
            <PipIcon size={16} />
          </button>
          <button
            type="button"
            className="floating-call-btn"
            onClick={expand}
            title="Back to call"
            aria-label="Back to call"
          >
            <ExpandIcon size={16} />
          </button>
          <button
            type="button"
            className="floating-call-btn floating-call-btn--danger"
            onClick={endCall}
            title="End call"
            aria-label="End call"
          >
            <PhoneOffIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
