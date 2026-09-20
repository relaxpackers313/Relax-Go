import { EventEmitter } from 'node:events';

/**
 * In-process domain events decouple services from the realtime gateway (no circular imports).
 * With multiple API nodes this becomes a Redis pub/sub adapter behind the same interface.
 */
export interface DomainEvents {
  'location.updated': { driverId: string; lat: number; lng: number; heading?: number; speed?: number; recordedAt: Date; source: 'foreground' | 'background' };
  'presence.changed': { driverId: string; online: boolean };
  'lead.created': { driverId: string; leadId: string; distanceKm?: number; pickupAddress?: string };
  'lead.status': { leadId: string; customerSessionId: string; driverId: string; status: string };
  'notification.created': { audienceKind: 'driver' | 'customer'; audienceId: string; title: string; body?: string; type: string };
}

class TypedEmitter {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(50);
  }
  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.emitter.emit(event, payload);
  }
  on<K extends keyof DomainEvents>(event: K, handler: (payload: DomainEvents[K]) => void): void {
    this.emitter.on(event, handler);
  }
}

export const events = new TypedEmitter();
