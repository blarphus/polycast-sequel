// ---------------------------------------------------------------------------
// hooks/useSocket.ts -- Socket lifecycle tied to auth state
// ---------------------------------------------------------------------------

import { useEffect, useState, useRef } from 'react';
import { socket, connectSocket, disconnectSocket } from '../socket';
import { useAuth } from './useAuth';

const HEARTBEAT_INTERVAL_MS = 30_000;

export function useSocket() {
  const { user } = useAuth();
  const [connected, setConnected] = useState(socket.connected);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) {
      disconnectSocket();
      return;
    }

    // Connect when authenticated
    connectSocket();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // Heartbeat
    heartbeatRef.current = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat');
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Sync initial state
    setConnected(socket.connected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      disconnectSocket();
    };
  }, [user]);

  return { socket, connected };
}
