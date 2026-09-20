import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { api } from './api';

/**
 * Production background location (spec §12–13, §61):
 * - Android: expo-location background updates run inside a FOREGROUND SERVICE with a visible
 *   notification — the platform-sanctioned way to keep GPS alive when the app is minimized
 *   or the screen is locked. iOS uses the 'location' background mode.
 * - Points queue locally (AsyncStorage) and flush in batches; a dropped network keeps the
 *   queue growing (capped) and the next flush drains it, so brief offline stretches lose nothing.
 * - Intervals come from platform config; the server validates every point again anyway.
 */

const TASK = 'relaxgo-driver-location';
const QUEUE_KEY = 'relaxgo_location_queue';
const MAX_QUEUE = 500;

interface QueuedPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  recordedAt: string;
  source: 'foreground' | 'background';
}

async function enqueue(points: QueuedPoint[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = raw ? (JSON.parse(raw) as QueuedPoint[]) : [];
    queue.push(...points);
    // Keep the newest points when the queue overflows (old fixes are the least useful).
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    // storage full/unavailable — drop silently; live tracking recovers on the next fix
  }
}

export async function flushQueue(): Promise<void> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY).catch(() => null);
  if (!raw) return;
  const queue = JSON.parse(raw) as QueuedPoint[];
  if (!queue.length) return;
  const batch = queue.slice(0, 50);
  try {
    await api('/driver/locations', { method: 'POST', body: { points: batch } });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(batch.length)));
    if (queue.length > batch.length) void flushQueue();
  } catch {
    // Offline or rejected — keep the queue for the next attempt.
  }
}

// Defined at module scope, as TaskManager requires: it runs even when no UI is mounted.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const background = AppState.currentState !== 'active';
  await enqueue(
    data.locations.map((l) => ({
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      accuracy: l.coords.accuracy ?? undefined,
      heading: l.coords.heading ?? undefined,
      speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed * 3.6 : undefined, // m/s → km/h
      recordedAt: new Date(l.timestamp).toISOString(),
      source: background ? 'background' : 'foreground',
    })),
  );
  await flushQueue();
});

export interface TrackingConfig {
  foregroundIntervalSeconds: number;
  backgroundIntervalSeconds: number;
}

export async function requestLocationPermissions(): Promise<{ foreground: boolean; background: boolean }> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { foreground: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync();
  return { foreground: true, background: bg.status === 'granted' };
}

/** Called when the driver goes ONLINE. Requires foreground permission; background is strongly recommended. */
export async function startTracking(cfg: TrackingConfig): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: cfg.backgroundIntervalSeconds * 1000,
    distanceInterval: 15,
    deferredUpdatesInterval: cfg.backgroundIntervalSeconds * 1000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'You are online on Relax Go',
      notificationBody: 'Customers nearby can see you. Go offline in the app to stop.',
      notificationColor: '#0f766e',
      killServiceOnDestroy: false,
    },
  });
}

/** Called when the driver goes OFFLINE — all sharing stops (privacy, spec §65). */
export async function stopTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(TASK);
  }
  await flushQueue();
}

export async function isTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);
}
