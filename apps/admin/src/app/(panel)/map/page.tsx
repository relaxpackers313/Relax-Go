'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { Badge, Card, ErrorState, Spinner } from '@/components/ui';

interface LiveDriver {
  driverId: string;
  name?: string;
  status: string;
  vehicleType?: string;
  registrationNumber?: string;
  location: { lat: number; lng: number };
  presence: 'active' | 'background' | 'stale' | 'offline';
  lastUpdate: string;
  battery: number | null;
}

interface PublicConfig {
  maps: { tileUrl: string; tileAttribution: string };
}

const PRESENCE_COLOR: Record<string, string> = { active: '#059669', background: '#0284c7', stale: '#d97706', offline: '#64748b' };

export default function LiveMapPage() {
  const mapRef = useRef<MlMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const [selected, setSelected] = useState<LiveDriver | null>(null);

  const cfg = useQuery({ queryKey: ['public-config'], queryFn: () => api<PublicConfig>('/config') });
  const q = useQuery({
    queryKey: ['live-map'],
    queryFn: () => api<{ drivers: LiveDriver[] }>('/admin/map/live'),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !cfg.data) return;
    // Map provider comes from platform settings (OSM raster tiles by default).
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: [cfg.data.maps.tileUrl], tileSize: 256, attribution: cfg.data.maps.tileAttribution } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [85.8828, 20.4625], // Cuttack — operator's home city; fitBounds overrides when drivers exist
      zoom: 11,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');
  }, [cfg.data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !q.data) return;
    const seen = new Set<string>();
    for (const d of q.data.drivers) {
      seen.add(d.driverId);
      const existing = markers.current.get(d.driverId);
      if (existing) {
        existing.setLngLat([d.location.lng, d.location.lat]);
        (existing.getElement().firstElementChild as HTMLElement).style.background = PRESENCE_COLOR[d.presence] ?? '#64748b';
      } else {
        const el = document.createElement('button');
        el.setAttribute('aria-label', d.name ?? 'driver');
        el.innerHTML = `<span style="display:block;width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);background:${PRESENCE_COLOR[d.presence]}"></span>`;
        el.addEventListener('click', () => setSelected(d));
        markers.current.set(d.driverId, new maplibregl.Marker({ element: el }).setLngLat([d.location.lng, d.location.lat]).addTo(map));
      }
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    if (q.data.drivers.length && !map.isMoving()) {
      const bounds = new maplibregl.LngLatBounds();
      for (const d of q.data.drivers) bounds.extend([d.location.lng, d.location.lat]);
      if (markers.current.size <= q.data.drivers.length) map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 500 });
    }
  }, [q.data]);

  return (
    <>
      <PageHeader title="Live operations map" sub="Every online driver with presence state. Refreshes every 10 seconds." />
      {cfg.isError || q.isError ? <ErrorState error={q.error ?? cfg.error} retry={() => q.refetch()} /> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="relative h-[70vh] overflow-hidden rounded-[var(--radius-card)] border border-slate-200 bg-slate-100">
          <div ref={containerRef} className="h-full w-full" />
          {(cfg.isPending || q.isPending) && <div className="absolute inset-0 grid place-items-center bg-white/60"><Spinner label="Loading map…" /></div>}
          {q.data && !q.data.drivers.length ? (
            <div className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-white px-4 py-1.5 text-[13px] text-slate-500 shadow">No drivers are online right now</div>
          ) : null}
          <div className="absolute bottom-3 left-3 flex gap-3 rounded-md bg-white/95 px-3 py-1.5 text-[12px] shadow">
            {Object.entries(PRESENCE_COLOR).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1.5 capitalize"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} /> {k}</span>
            ))}
          </div>
        </div>
        <Card title={selected ? 'Driver' : 'Select a driver'}>
          {selected ? (
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd className="font-medium">{selected.name ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Vehicle</dt><dd>{selected.vehicleType} · {selected.registrationNumber}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Presence</dt><dd><Badge value={selected.presence} /></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Last update</dt><dd>{timeAgo(selected.lastUpdate)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Battery</dt><dd>{selected.battery != null ? `${selected.battery}%` : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Position</dt><dd>{selected.location.lat.toFixed(5)}, {selected.location.lng.toFixed(5)}</dd></div>
              <a href={`/drivers/${selected.driverId}`} className="mt-2 inline-block font-medium text-brand-600 hover:underline">Open driver profile →</a>
            </dl>
          ) : (
            <p className="text-[13px] text-slate-400">Click a marker to see the driver's live details. {q.data ? `${q.data.drivers.length} online.` : ''}</p>
          )}
        </Card>
      </div>
    </>
  );
}
