import { useLocation, useNavigate } from 'react-router-dom';
import { useActiveGroupCall } from '../contexts/GroupCallProvider';

export default function FloatingGroupCallTile() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { active, postId, callStatus, participants, leaveRoom } = useActiveGroupCall();

  if (!active || !postId || pathname === `/group-call/${postId}`) return null;

  const status = callStatus === 'connected'
    ? `${participants.length + 1} participant${participants.length === 0 ? '' : 's'}`
    : callStatus;

  return (
    <aside className="floating-group-call" aria-label="Active group call">
      <button
        className="floating-group-call__return"
        onClick={() => navigate(`/group-call/${postId}`)}
      >
        <span className="floating-group-call__pulse" aria-hidden="true" />
        <span>
          <strong>Group call</strong>
          <small>{status}</small>
        </span>
      </button>
      <button className="floating-group-call__end" onClick={leaveRoom} aria-label="End group call">
        End
      </button>
    </aside>
  );
}
