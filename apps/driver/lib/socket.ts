import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL, getToken } from './api';

let socket: Socket | null = null;

export async function getSocket(): Promise<Socket | null> {
  if (socket) return socket;
  const token = await getToken();
  if (!token) return null;
  socket = io(SOCKET_URL, { path: '/realtime', auth: { token }, transports: ['websocket'], reconnection: true, reconnectionDelayMax: 10_000 });
  return socket;
}

export function resetSocket(): void {
  socket?.disconnect();
  socket = null;
}
