import { io } from 'socket.io-client';

// One shared WebSocket per tab, connected lazily through the gateway.
let socket;

export function getSocket() {
  if (!socket) socket = io({ path: '/socket.io', transports: ['websocket'], withCredentials: true });
  return socket;
}

// Reconnect after sign-in/out so the server sees the new session cookie.
export function resetSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
