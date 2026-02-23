// ---------------------------------------------------------------------------
// socket.ts -- Socket.IO client singleton
// ---------------------------------------------------------------------------

import { io, Socket } from 'socket.io-client';

// Connect to same origin (empty string) with cookie-based auth
const socket: Socket = io('', {
  withCredentials: true,
  autoConnect: false, // We connect explicitly after auth is confirmed
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

export function connectSocket(): void {
  if (!socket.connected) {
    socket.connect();
  }
}

export function disconnectSocket(): void {
  if (socket.connected) {
    socket.disconnect();
  }
}

export { socket };
export default socket;
