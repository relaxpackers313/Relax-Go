import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { verifyAccessToken } from '../lib/tokens';
import { events } from '../lib/events';
import { getSettings } from '../modules/settings/settings.service';
import { logger } from '../lib/logger';
import { isAllowedOrigin } from '../config/env';

/**
 * Realtime transport (spec §14): authenticated Socket.IO with driver rooms and per-driver
 * location channels customers subscribe to. Location fan-out is throttled per driver from
 * config; server timestamps ride along so clients can detect staleness themselves.
 */
export function initRealtime(server: HttpServer): Server {
  const io = new Server(server, {
    path: '/realtime',
    cors: {
      origin: (origin, cb) => (isAllowedOrigin(origin) ? cb(null, true) : cb(new Error('Origin not allowed'))),
      credentials: true,
    },
    // Mobile clients pass the JWT in handshake auth, so polling upgrade is fine.
  });

  io.use((socket, next) => {
    try {
      const token = (socket.handshake.auth?.token ?? '') as string;
      const payload = verifyAccessToken(token);
      socket.data.kind = payload.kind;
      socket.data.id = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const MAX_WATCHED = 60;

  io.on('connection', (socket: Socket) => {
    const { kind, id } = socket.data as { kind: string; id: string };

    if (kind === 'driver') {
      void socket.join(`driver:${id}`);
    } else if (kind === 'customer') {
      void socket.join(`customer:${id}`);
      // Subscribe to live positions of drivers on screen (the discovery list / an active lead).
      socket.on('watch', (payload: { driverIds?: string[] }) => {
        const ids = (payload?.driverIds ?? []).filter((d) => typeof d === 'string' && /^[a-f0-9]{24}$/.test(d)).slice(0, MAX_WATCHED);
        for (const room of socket.rooms) if (room.startsWith('loc:')) void socket.leave(room);
        for (const driverId of ids) void socket.join(`loc:${driverId}`);
        socket.emit('watching', { driverIds: ids });
      });
    } else if (kind === 'admin') {
      void socket.join('admins');
    }

    socket.on('error', (err) => logger.debug({ err }, 'socket error'));
  });

  // ---- Domain event fan-out ----
  const lastSent = new Map<string, number>();
  setInterval(() => {
    // Prevent unbounded growth of the throttle map.
    if (lastSent.size > 20_000) lastSent.clear();
  }, 60_000).unref();

  events.on('location.updated', (p) => {
    void (async () => {
      // getSettings() is memory-cached, so this is cheap and picks up admin changes live.
      const throttleMs = (await getSettings()).location.realtimeThrottleSeconds * 1000;
      const now = Date.now();
      const last = lastSent.get(p.driverId) ?? 0;
      if (throttleMs > 0 && now - last < throttleMs) return;
      lastSent.set(p.driverId, now);
      io.to(`loc:${p.driverId}`).to('admins').emit('driver:location', {
        driverId: p.driverId,
        lat: p.lat,
        lng: p.lng,
        heading: p.heading ?? null,
        speed: p.speed ?? null,
        recordedAt: p.recordedAt.toISOString(),
        serverAt: new Date(now).toISOString(),
        source: p.source,
      });
    })();
  });

  events.on('presence.changed', (p) => {
    io.to(`loc:${p.driverId}`).to('admins').emit('driver:presence', { driverId: p.driverId, online: p.online, serverAt: new Date().toISOString() });
  });

  events.on('lead.created', (p) => {
    io.to(`driver:${p.driverId}`).emit('lead:new', { leadId: p.leadId, distanceKm: p.distanceKm ?? null, pickupAddress: p.pickupAddress ?? null });
  });

  events.on('lead.status', (p) => {
    io.to(`customer:${p.customerSessionId}`).emit('lead:status', { leadId: p.leadId, status: p.status });
    io.to(`driver:${p.driverId}`).emit('lead:status', { leadId: p.leadId, status: p.status });
  });

  events.on('notification.created', (p) => {
    io.to(`${p.audienceKind}:${p.audienceId}`).emit('notification', { type: p.type, title: p.title, body: p.body ?? null });
  });

  return io;
}
