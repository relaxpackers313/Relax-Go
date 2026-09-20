import * as Location from 'expo-location';

/**
 * Warm GPS cache: primed while the intro animation plays (never prompts — it only reads the
 * OS's last known fix if permission is already granted), so the home map can recenter the
 * instant it mounts instead of waiting seconds for a fresh satellite fix.
 */
let cached: { lat: number; lng: number } | null = null;

export function warmUpLocation() {
  void (async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const last = await Location.getLastKnownPositionAsync();
      if (last) cached = { lat: last.coords.latitude, lng: last.coords.longitude };
    } catch {
      // best effort only
    }
  })();
}

export const getWarmLocation = () => cached;
