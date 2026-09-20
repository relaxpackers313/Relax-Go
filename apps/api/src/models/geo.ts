import { Schema } from 'mongoose';

export interface GeoPoint {
  type: 'Point';
  /** [lng, lat] — GeoJSON order. */
  coordinates: [number, number];
}

export const geoPointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => v.length === 2 && v[0]! >= -180 && v[0]! <= 180 && v[1]! >= -90 && v[1]! <= 90,
        message: 'coordinates must be [lng, lat] within bounds',
      },
    },
  },
  { _id: false },
);

export const toGeoPoint = (p: { lat: number; lng: number }): GeoPoint => ({ type: 'Point', coordinates: [p.lng, p.lat] });
export const fromGeoPoint = (g: GeoPoint): { lat: number; lng: number } => ({ lat: g.coordinates[1], lng: g.coordinates[0] });
