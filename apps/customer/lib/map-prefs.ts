import { create } from 'zustand';

/** Map view preference shared by every map screen: normal or satellite (hybrid keeps labels). */
interface MapPrefs {
  mapType: 'standard' | 'hybrid';
  toggle: () => void;
}

export const useMapPrefs = create<MapPrefs>((set) => ({
  mapType: 'standard',
  toggle: () => set((s) => ({ mapType: s.mapType === 'standard' ? 'hybrid' : 'standard' })),
}));
