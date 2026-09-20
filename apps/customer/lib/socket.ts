import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL, getSessionToken } from './api';

let socket: Socket | null = null;

/** One realtime connection per app run; reconnects transparently and re-watches on reconnect. */
export async function getSocket(): Promise<Socket> {
  if (socket) return socket;
  const token = await getSessionToken();
  socket = io(SOCKET_URL, {
    path: '/realtime',
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });
  return socket;
}

let watched: string[] = [];

export async function watchDrivers(driverIds: string[]): Promise<void> {
  watched = driverIds;
  const s = await getSocket();
  s.emit('watch', { driverIds });
  s.off('reconnect');
  s.io.on('reconnect', () => s.emit('watch', { driverIds: watched }));
}
