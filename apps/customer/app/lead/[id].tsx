import { useEffect, useRef, useState } from 'react';
import { Image, Linking, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { haversineKm } from '@relaxgo/shared';
import { api, API_URL } from '@/lib/api';
import { decodePolyline } from '@/lib/geo';
import { getSocket, watchDrivers } from '@/lib/socket';
import { registerPushToken } from '@/lib/push';
import { useMapPrefs } from '@/lib/map-prefs';
import { colors } from '@/lib/theme';
import { Button, Card, Muted, Pill, Row, Title } from '@/components/ui';

interface LeadDetail {
  _id: string;
  driverId: string;
  status: string;
  distanceKm: number;
  vehicleType: string;
  pickup: { location: { coordinates: [number, number] }; address?: string };
  statusHistory: { status: string; at: string }[];
  createdAt: string;
  expiresAt: string;
  driver?: {
    name: string;
    photoUrl: string | null;
    vehicleType: string | null;
    vehicleModel: string | null;
    registrationNumber: string | null;
    rating: { average: number | null; count: number };
  } | null;
}

const STATUS_COPY: Record<string, { text: string; tone: 'default' | 'good' | 'warn' | 'bad' }> = {
  created: { text: 'Enquiry started', tone: 'default' },
  shown: { text: 'Driver has your enquiry', tone: 'default' },
  viewed: { text: 'Driver is looking at it', tone: 'warn' },
  accepted: { text: 'Driver accepted', tone: 'good' },
  contacted: { text: 'You are in touch with the driver', tone: 'good' },
  converted: { text: 'Trip confirmed', tone: 'good' },
  rejected: { text: 'Driver declined — pick another driver nearby', tone: 'bad' },
  expired: { text: 'Enquiry expired', tone: 'bad' },
  cancelled: { text: 'Cancelled', tone: 'default' },
};

const SPRITES: Record<string, { src: ReturnType<typeof require>; w: number; h: number }> = {
  car: { src: require('../../assets/vehicles/car.png'), w: 30, h: 56 },
  auto: { src: require('../../assets/vehicles/auto.png'), w: 32, h: 56 },
  bike: { src: require('../../assets/vehicles/bike.png'), w: 22, h: 56 },
};
const PICKUP_PIN = require('../../assets/vehicles/pickup-pin.png');

function Stars({ average }: { average: number | null }) {
  const full = Math.round(average ?? 0);
  return (
    <Text style={{ fontSize: 13, letterSpacing: 1 }}>
      <Text style={{ color: '#F5A623' }}>{'★'.repeat(full)}</Text>
      <Text style={{ color: '#D8DCE3' }}>{'★'.repeat(5 - full)}</Text>
      {average != null ? <Text style={{ color: colors.muted }}>  {average.toFixed(1)}</Text> : <Text style={{ color: colors.muted }}>  new</Text>}
    </Text>
  );
}

/** Live tracking (spec §57): the driver approaching on the Google map with the road route,
 *  the driver-info card, live "Arriving in X min · Y km", call-again, SOS and share. */
export default function LeadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const mapRef = useRef<MapView>(null);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [stars, setStars] = useState(0);
  const [rated, setRated] = useState(false);
  const mapType = useMapPrefs((s) => s.mapType);
  const toggleMapType = useMapPrefs((s) => s.toggle);

  const q = useQuery({
    queryKey: ['lead', id],
    queryFn: () => api<LeadDetail>(`/customer/leads/${id}`),
    refetchInterval: 15_000,
  });

  const cfg = useQuery({
    queryKey: ['config'],
    queryFn: () => api<{ safety: { sosEnabled: boolean; sosNumbers: string[]; tripSharingEnabled: boolean } }>('/config'),
  });
  const trips = useQuery({
    queryKey: ['my-trips'],
    queryFn: () => api<{ items: { _id: string; leadId: string; status: string; shareToken?: string }[] }>('/customer/trips'),
  });
  const myTrip = trips.data?.items.find((t) => t.leadId === id);

  useEffect(() => {
    void registerPushToken();
  }, []);

  useEffect(() => {
    if (!q.data) return;
    void watchDrivers([q.data.driverId]);
    let mounted = true;
    void getSocket().then((s) => {
      s.on('driver:location', (p: { driverId: string; lat: number; lng: number }) => {
        if (mounted && p.driverId === q.data.driverId) setDriverPos({ lat: p.lat, lng: p.lng });
      });
      s.on('lead:status', (p: { leadId: string }) => {
        if (p.leadId === id) void qc.invalidateQueries({ queryKey: ['lead', id] });
      });
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.driverId]);

  const cancel = useMutation({
    mutationFn: () => api(`/customer/leads/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lead', id] }),
  });

  const rate = useMutation({
    mutationFn: (value: number) => api(`/customer/leads/${id}/rating`, { method: 'POST', body: { stars: value } }),
    onSuccess: () => setRated(true),
  });

  const pickupLat = q.data?.pickup.location.coordinates[1];
  const pickupLng = q.data?.pickup.location.coordinates[0];
  const from = driverPos ?? null;

  // Road route from the driver's LIVE position to the pickup, refreshed as they move.
  const route = useQuery({
    queryKey: ['lead-route', id, from ? `${from.lat.toFixed(3)},${from.lng.toFixed(3)}` : 'none'],
    enabled: !!from && pickupLat !== undefined,
    staleTime: 20_000,
    queryFn: () =>
      api<{ provider: string; distanceKm: number; durationMinutes: number; polyline: string | null }>(
        `/customer/geo/route?fromLat=${from!.lat}&fromLng=${from!.lng}&toLat=${pickupLat}&toLng=${pickupLng}&vehicleType=${q.data?.vehicleType ?? ''}`,
      ),
  });
  const routePoints = route.data?.polyline ? decodePolyline(route.data.polyline) : null;

  const callAgain = useMutation({
    mutationFn: () =>
      api<{ phone: string }>('/customer/calls', {
        method: 'POST',
        body: {
          driverId: q.data!.driverId,
          pickup: { lat: pickupLat!, lng: pickupLng!, address: q.data!.pickup.address },
          vehicleType: q.data!.vehicleType,
        },
      }),
    onSuccess: (res) => void Linking.openURL(`tel:${res.phone}`),
  });

  useEffect(() => {
    if (!driverPos || pickupLat === undefined || pickupLng === undefined) return;
    mapRef.current?.fitToCoordinates(
      routePoints ?? [
        { latitude: driverPos.lat, longitude: driverPos.lng },
        { latitude: pickupLat, longitude: pickupLng },
      ],
      { edgePadding: { top: 120, bottom: 340, left: 60, right: 60 }, animated: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.data?.polyline, driverPos?.lat]);

  if (q.isPending) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Muted>Loading your enquiry…</Muted></View>;
  if (q.isError) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Muted>Enquiry not found.</Muted></View>;

  const lead = q.data;
  const copy = STATUS_COPY[lead.status] ?? { text: lead.status, tone: 'default' as const };
  const active = ['created', 'shown', 'viewed', 'accepted', 'contacted'].includes(lead.status);
  const canRate = ['contacted', 'converted'].includes(lead.status) && !rated;

  const liveKm = route.data?.distanceKm ?? (driverPos ? Math.round(haversineKm(driverPos, { lat: pickupLat!, lng: pickupLng! }) * 100) / 100 : lead.distanceKm || null);
  const etaMin = route.data?.durationMinutes ?? (liveKm != null ? Math.max(1, Math.round((liveKm / 22) * 60)) : null);
  const d = lead.driver;
  const sprite = SPRITES[d?.vehicleType ?? lead.vehicleType] ?? SPRITES.car!;

  if (active) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          provider={PROVIDER_GOOGLE}
          mapType={mapType}
          initialRegion={{ latitude: pickupLat!, longitude: pickupLng!, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
          showsCompass={false}
          toolbarEnabled={false}
        >
          {routePoints ? <Polyline coordinates={routePoints} strokeWidth={7} strokeColor="#0f172a" lineCap="round" lineJoin="round" /> : null}
          {/* Native marker images — custom child views don't render under the new architecture. */}
          <Marker coordinate={{ latitude: pickupLat!, longitude: pickupLng! }} anchor={{ x: 0.5, y: 0.95 }} image={PICKUP_PIN} title="Your pickup" />
          {driverPos ? (
            <Marker
              coordinate={{ latitude: driverPos.lat, longitude: driverPos.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              flat
              image={sprite.src}
              title={d?.name ?? 'Your driver'}
              description={liveKm != null ? `${liveKm} km away` : undefined}
            />
          ) : null}
        </MapView>

        {/* Floating status pill + satellite toggle */}
        <View style={styles.statusPill}>
          <Pill text={lead.status} tone={copy.tone} />
          <Text style={{ color: colors.text, fontWeight: '600', flexShrink: 1 }}>{copy.text}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Toggle satellite view" style={styles.mapTypeFab} onPress={toggleMapType}>
          <Ionicons name={mapType === 'standard' ? 'layers-outline' : 'map-outline'} size={19} color={colors.ink} />
        </TouchableOpacity>

        {/* Driver Info card — the reference interface */}
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Driver Info</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {d?.photoUrl ? (
              <Image source={{ uri: d.photoUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: '#EEF1F5', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: colors.brand }}>{(d?.name ?? 'D').slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colors.brand }}>{d?.name ?? 'Your driver'}</Text>
              <Stars average={d?.rating.average ?? null} />
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {[d?.vehicleModel ?? (d?.vehicleType ? d.vehicleType[0]!.toUpperCase() + d.vehicleType.slice(1) : null), d?.registrationNumber]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>ARRIVING IN</Text>
              <Text style={{ color: colors.text, fontSize: 24, fontWeight: '900' }}>
                {etaMin != null ? String(etaMin).padStart(2, '0') : '--'}
                <Text style={{ fontSize: 13, fontWeight: '700' }}> min{etaMin === 1 ? '' : 's'}</Text>
              </Text>
              {liveKm != null ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {liveKm} km {route.data?.provider === 'google' ? 'by road' : driverPos ? 'away (live)' : 'at enquiry'}
                </Text>
              ) : null}
            </View>
          </View>

          {callAgain.isError ? (
            <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>
              {callAgain.error instanceof Error ? callAgain.error.message : 'Could not start the call'}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            {cfg.data?.safety.sosEnabled ? (
              <TouchableOpacity
                style={styles.roundBtn}
                accessibilityLabel="SOS emergency call"
                onPress={() => void Linking.openURL(`tel:${cfg.data!.safety.sosNumbers[0] ?? '112'}`)}
              >
                <Ionicons name="alert-circle" size={22} color="#DC2626" />
              </TouchableOpacity>
            ) : null}
            {cfg.data?.safety.tripSharingEnabled && myTrip?.shareToken ? (
              <TouchableOpacity
                style={styles.roundBtn}
                accessibilityLabel="Share trip"
                onPress={() => void Share.share({ message: `Following my Relax Go trip live: ${API_URL}/shared/trips/${myTrip.shareToken}/view` })}
              >
                <Ionicons name="share-social" size={19} color={colors.ink} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.callBtn}
              disabled={callAgain.isPending}
              onPress={() => callAgain.mutate()}
              accessibilityRole="button"
              accessibilityLabel="Call the driver"
            >
              <Ionicons name="call" size={17} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{callAgain.isPending ? '…' : 'Call driver'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} disabled={cancel.isPending} onPress={() => cancel.mutate()} accessibilityRole="button">
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{cancel.isPending ? '…' : 'Cancel'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>Enquiry status</Title>
          <Pill text={lead.status} tone={copy.tone} />
        </View>
        <Text style={{ marginTop: 6, color: colors.text, fontSize: 15 }}>{copy.text}</Text>
        <View style={{ height: 6 }} />
        {d ? <Row label="Driver" value={`${d.name}${d.registrationNumber ? ` · ${d.registrationNumber}` : ''}`} /> : null}
        <Row label="Pickup" value={lead.pickup.address ?? `${pickupLat!.toFixed(4)}, ${pickupLng!.toFixed(4)}`} />
        <Row label="Driver distance at enquiry" value={lead.distanceKm ? `${lead.distanceKm} km` : '—'} />
        <View style={{ marginTop: 8, gap: 3 }}>
          {lead.statusHistory.map((s, i) => (
            <Text key={i} style={{ fontSize: 12, color: colors.muted }}>
              {new Date(s.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} — {STATUS_COPY[s.status]?.text ?? s.status}
            </Text>
          ))}
        </View>
      </Card>

      {canRate ? (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>How was the driver?</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((v) => (
              <Text key={v} onPress={() => setStars(v)} style={{ fontSize: 30 }} accessibilityRole="button" accessibilityLabel={`${v} stars`}>
                {v <= stars ? '★' : '☆'}
              </Text>
            ))}
          </View>
          {stars > 0 ? <Button title="Submit rating" loading={rate.isPending} onPress={() => rate.mutate(stars)} /> : null}
        </Card>
      ) : null}
      {rated ? <Muted center>Thanks — your rating helps other customers.</Muted> : null}

      <Button title="Find another driver" onPress={() => router.replace('/')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  statusPill: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 72,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  mapTypeFab: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 22,
    elevation: 14,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#E2E6EC', marginBottom: 10 },
  sheetTitle: { fontSize: 13, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  roundBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F1F3F7', alignItems: 'center', justifyContent: 'center' },
  callBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#17B26A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cancelBtn: { paddingHorizontal: 18, height: 48, borderRadius: 24, backgroundColor: '#1F2733', alignItems: 'center', justifyContent: 'center' },
  pinHead: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#17B26A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    elevation: 4,
  },
  pinDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  pinStem: { width: 3, height: 12, backgroundColor: '#1F2733' },
});
