import { useEffect, useRef } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { DiscoveredDriver } from '@relaxgo/shared';
import { api, ApiError } from '@/lib/api';
import { decodePolyline } from '@/lib/geo';
import { useTripComposer } from '@/lib/trip-store';
import { useMapPrefs } from '@/lib/map-prefs';
import { colors } from '@/lib/theme';
import { Button, Muted } from '@/components/ui';

const SPRITES: Record<string, { src: ReturnType<typeof require>; w: number; h: number }> = {
  car: { src: require('../../assets/vehicles/car.png'), w: 30, h: 56 },
  auto: { src: require('../../assets/vehicles/auto.png'), w: 32, h: 56 },
  bike: { src: require('../../assets/vehicles/bike.png'), w: 22, h: 56 },
};
const PICKUP_PIN = require('../../assets/vehicles/pickup-pin.png');
const ETA_DOT = require('../../assets/vehicles/eta-dot.png');

interface RouteInfo {
  provider: string;
  distanceKm: number;
  durationMinutes: number;
  polyline: string | null;
}

/**
 * Driver checkout (the "distance interface"): the real road route from the driver to your
 * pickup drawn on the Google map with distance + ETA chips, the driver-info card underneath,
 * and ONE action — call the driver directly and talk. No request form, no booking.
 */
export default function DriverCheckoutScreen() {
  const { driverId } = useLocalSearchParams<{ driverId: string }>();
  const mapRef = useRef<MapView>(null);
  const pickup = useTripComposer((s) => s.pickup);
  const mapType = useMapPrefs((s) => s.mapType);
  const toggleMapType = useMapPrefs((s) => s.toggle);

  // Fresh card for this driver, discovered around the pickup point (map centre).
  const driver = useQuery({
    queryKey: ['driver-card', driverId, pickup?.lat, pickup?.lng],
    queryFn: async () => {
      let at = pickup;
      if (!at) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        at = { label: 'My location', lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      const res = await api<{ drivers: DiscoveredDriver[] }>(`/customer/drivers/nearby?lat=${at.lat}&lng=${at.lng}`);
      const found = res.drivers.find((d) => d.driverId === driverId);
      if (!found) throw new ApiError(404, 'gone', 'This driver just went offline. Pick another one nearby.');
      return { found, me: { lat: at.lat, lng: at.lng }, pickupLabel: at.label };
    },
  });

  const d = driver.data?.found;
  const me = driver.data?.me;

  // Real road route driver → pickup: polyline + road distance + ETA (falls back to straight line).
  const route = useQuery({
    queryKey: ['route', driverId, me?.lat, me?.lng],
    enabled: !!d && !!me,
    refetchInterval: 30_000,
    queryFn: () =>
      api<RouteInfo>(
        `/customer/geo/route?fromLat=${d!.location.lat}&fromLng=${d!.location.lng}&toLat=${me!.lat}&toLng=${me!.lng}&vehicleType=${d!.vehicleType}`,
      ),
  });

  const routePoints = route.data?.polyline ? decodePolyline(route.data.polyline) : null;

  // Frame the whole route (or both endpoints) once we know them.
  useEffect(() => {
    if (!d || !me) return;
    const coords = routePoints ?? [
      { latitude: d.location.lat, longitude: d.location.lng },
      { latitude: me.lat, longitude: me.lng },
    ];
    const t = setTimeout(
      () => mapRef.current?.fitToCoordinates(coords, { edgePadding: { top: 120, bottom: 320, left: 60, right: 60 }, animated: true }),
      350,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.driverId, me?.lat, me?.lng, route.data?.polyline]);

  const call = useMutation({
    mutationFn: () =>
      api<{ phone: string; leadId: string }>('/customer/calls', {
        method: 'POST',
        body: {
          driverId,
          pickup: { lat: me!.lat, lng: me!.lng, address: driver.data!.pickupLabel?.slice(0, 300) },
          vehicleType: d!.vehicleType,
        },
      }),
    onSuccess: (res) => {
      void Linking.openURL(`tel:${res.phone}`);
      router.replace(`/lead/${res.leadId}`);
    },
  });

  if (driver.isPending) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>Checking driver availability…</Muted>
      </View>
    );
  }
  if (driver.isError || !d || !me) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <Muted center>{driver.error instanceof Error ? driver.error.message : 'Driver unavailable'}</Muted>
        <Button title="Back to nearby drivers" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const sprite = SPRITES[d.vehicleType] ?? SPRITES.car!;
  const km = route.data?.distanceKm ?? d.distanceKm;
  const eta = route.data?.durationMinutes ?? Math.max(1, Math.round((d.distanceKm / 22) * 60));
  const starsFull = Math.round(d.rating.average ?? 0);
  const mid = routePoints?.[Math.floor(routePoints.length / 2)];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        mapType={mapType}
        initialRegion={{ latitude: me.lat, longitude: me.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {routePoints ? (
          <Polyline coordinates={routePoints} strokeWidth={7} strokeColor="#0f172a" lineCap="round" lineJoin="round" />
        ) : (
          <Polyline
            coordinates={[
              { latitude: d.location.lat, longitude: d.location.lng },
              { latitude: me.lat, longitude: me.lng },
            ]}
            strokeWidth={5}
            strokeColor="#0f172a"
            lineDashPattern={[14, 10]}
          />
        )}

        {/* Driver end: vehicle sprite. Native marker images — custom child views
            do not render under the new architecture, so every marker is an image. */}
        <Marker
          coordinate={{ latitude: d.location.lat, longitude: d.location.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          flat
          rotation={d.heading ?? 0}
          image={sprite.src}
          title={`${d.name.split(' ')[0]} · ${d.vehicleType}`}
          description={`${km} km · about ${eta} min away`}
        />

        {/* Pickup end: green pin */}
        <Marker
          coordinate={{ latitude: me.lat, longitude: me.lng }}
          anchor={{ x: 0.5, y: 0.95 }}
          image={PICKUP_PIN}
          title="Your pickup"
          description={(driver.data.pickupLabel ?? 'Pinned location').split(',').slice(0, 2).join(',')}
        />

        {/* ETA marker at the route midpoint (tap for details) */}
        {mid ? <Marker coordinate={mid} anchor={{ x: 0.5, y: 0.5 }} image={ETA_DOT} title={`${eta} min`} description={`${km} km by road`} /> : null}
      </MapView>

      {/* Back + satellite buttons */}
      <Pressable accessibilityRole="button" accessibilityLabel="Back" style={[styles.fab, { top: 46, left: 14 }]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={20} color={colors.ink} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Toggle satellite view" style={[styles.fab, { top: 46, right: 14 }]} onPress={toggleMapType}>
        <Ionicons name={mapType === 'standard' ? 'layers-outline' : 'map-outline'} size={19} color={colors.ink} />
      </Pressable>

      {/* Driver Info card + one action: CALL */}
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>Driver Info</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {d.photoUrl ? (
            <Image source={{ uri: d.photoUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: '#EEF1F5', alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: colors.brand }}>{d.name.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: colors.brand }}>{d.name}</Text>
            <Text style={{ fontSize: 13, letterSpacing: 1 }}>
              <Text style={{ color: '#F5A623' }}>{'★'.repeat(starsFull)}</Text>
              <Text style={{ color: '#D8DCE3' }}>{'★'.repeat(5 - starsFull)}</Text>
              <Text style={{ color: colors.muted }}>  {d.rating.count ? `${d.rating.average} (${d.rating.count})` : 'new'}</Text>
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {`${d.vehicleModel ?? d.vehicleType}${d.registrationNumber ? ` · ${d.registrationNumber}` : ''}`}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>ARRIVING IN</Text>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: '900' }}>
              {String(eta).padStart(2, '0')}
              <Text style={{ fontSize: 13, fontWeight: '700' }}> min{eta === 1 ? '' : 's'}</Text>
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {km} km {route.data?.provider === 'google' ? 'by road' : 'from you'}
            </Text>
          </View>
        </View>

        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>
          Call the driver directly — agree the fare and details on the phone. No booking, no waiting.
        </Text>
        {call.isError ? (
          <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>
            {call.error instanceof Error ? call.error.message : 'Could not start the call'}
          </Text>
        ) : null}

        <TouchableOpacity
          style={styles.callBtn}
          disabled={call.isPending}
          onPress={() => call.mutate()}
          accessibilityRole="button"
          accessibilityLabel={`Call ${d.name}`}
        >
          <Ionicons name="call" size={20} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 17 }}>
            {call.isPending ? 'Connecting…' : `Call ${d.name.split(' ')[0]}`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
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
  callBtn: {
    marginTop: 12,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#17B26A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  chipWhite: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 180,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  chipWhiteText: { fontSize: 12, fontWeight: '700', color: '#1F2733' },
  chipDark: { backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, alignItems: 'center' },
  chipDarkBig: { color: '#fff', fontWeight: '900', fontSize: 15, lineHeight: 17 },
  chipDarkSmall: { color: '#9CA3AF', fontWeight: '800', fontSize: 9, letterSpacing: 1 },
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
