import { create } from 'zustand';

export interface PickedPlace {
  label: string;
  lat: number;
  lng: number;
}

/** Cross-screen state for composing a request: pickup (map-center) and destination survive navigation. */
interface TripComposer {
  pickup: PickedPlace | null;
  destination: PickedPlace | null;
  setPickup: (place: PickedPlace | null) => void;
  setDestination: (place: PickedPlace | null) => void;
}

export const useTripComposer = create<TripComposer>((set) => ({
  pickup: null,
  destination: null,
  setPickup: (pickup) => set({ pickup }),
  setDestination: (destination) => set({ destination }),
}));
