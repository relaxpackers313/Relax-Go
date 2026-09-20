import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { DiscoveredDriver } from '@relaxgo/shared';
import { api } from '@/lib/api';
import { watchDrivers, getSocket } from '@/lib/socket';
import { useTripComposer } from '@/lib/trip-store';
import { useMapPrefs } from '@/lib/map-prefs';
import { getWarmLocation } from '@/lib/location-cache';
import { colors, radius, shadow } from '@/lib/theme';
import { Button, Centered, Muted, Title } from '@/components/ui';

interface PublicConfig {
  vehicleTypes: { key: string; label: string }[];
  discovery: { defaultRadiusKm: number; maxRadiusKm: number };
}

// Our own top-down sprites (generated originals in assets/vehicles).
const SPRITES: Record<string, { src: ReturnType<typeof require>; w: number; h: number }> = {
  car: { src: require('../assets/vehicles/car.png'), w: 26, h: 48 },
  auto: { src: require('../assets/vehicles/auto.png'), w: 30, h: 48 },
  bike: { src: require('../assets/vehicles/bike.png'), w: 18, h: 48 },
};
const ME_DOT = require('../assets/vehicles/me-dot.png');
const LOGO = require('../assets/splash-logo.png');
const VEHICLE_MCI: Record<string, string> = { bike: 'motorbike', auto: 'rickshaw', car: 'car-hatchback' };
const etaMinutes = (km: number) => Math.max(1, Math.round((km / 22) * 60));

/**
 * Map-first home on the native Google map (satellite toggle included): pickup pill on top
 * (map centre = pickup, reverse-geocoded to a real address), live top-down vehicle sprites,
 * green pickup pin fixed at the centre, and the nearest-first driver list with one-tap CALL —
 * tapping a driver opens the route/distance screen where the call happens.
 */
export default function HomeScreen() {
  const mapRef = useRef<MapView>(null);
  const qc = useQueryClient();
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [vehicleType, setVehicleType] = useState<string>('');
  const [live, setLive] = useState<Record<string, { lat: number; lng: number; heading?: number | null }>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const destination = useTripComposer((s) => s.destination);
  const setPickup = useTripComposer((s) => s.setPickup);
  const mapType = useMapPrefs((s) => s.mapType);
  const toggleMapType = useMapPrefs((s) => s.toggle);

  const config = useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/config') });

  const hasCentered = useRef(false);
  const flyTo = useCallback((lat: number, lng: number) => {
    hasCentered.current = true;
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 700);
  }, []);

  const locate = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setPermission('denied');
      return;
    }
    setPermission('granted');
    // Recenter INSTANTLY on the best position already available (warm cache from the intro,
    // else the OS's last-known fix) — a cold GPS fix can take many seconds, and the map must
    // never sit at country zoom waiting for it.
    const quick =
      getWarmLocation() ??
      (await Location.getLastKnownPositionAsync().then((last) => (last ? { lat: last.coords.latitude, lng: last.coords.longitude } : null)).catch(() => null));
    if (quick) {
      setMe(quick);
      setCenter((c) => c ?? quick);
      flyTo(quick.lat, quick.lng);
    }
    // Then refine with a fresh fix.
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setMe(point);
    setCenter((c) => c ?? point);
    flyTo(point.lat, point.lng);
  }, [flyTo]);

  useEffect(() => {
    void locate();
  }, [locate]);

  // Follow the customer's live position so the "you are here" dot stays accurate,
  // and recenter on the very first fix if nothing has centered the map yet.
  useEffect(() => {
    if (permission !== 'granted') return;
    let sub: Location.LocationSubscription | undefined;
    void Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 15 }, (pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setMe(p);
      if (!hasCentered.current) {
        setCenter((c) => c ?? p);
        flyTo(p.lat, p.lng);
      }
    }).then((s) => {
      sub = s;
    });
    return () => sub?.remove();
  }, [permission, flyTo]);

  // Map centre = pickup point; reverse-geocode it for the pill (debounced by query key).
  const pickupLabel = useQuery({
    queryKey: ['reverse', center ? `${center.lat.toFixed(4)},${center.lng.toFixed(4)}` : 'none'],
    enabled: !!center,
    staleTime: 60_000,
    queryFn: () => api<{ label: string | null }>(`/customer/geo/reverse?lat=${center!.lat}&lng=${center!.lng}`),
  });
  const pickupText = pickupLabel.data?.label ?? 'Locating…';

  useEffect(() => {
    if (center) setPickup({ label: pickupLabel.data?.label ?? 'Pinned location', lat: center.lat, lng: center.lng });
  }, [center, pickupLabel.data, setPickup]);

  const nearby = useQuery({
    queryKey: ['nearby', center?.lat.toFixed(3), center?.lng.toFixed(3), vehicleType],
    enabled: !!center,
    refetchInterval: 20_000,
    queryFn: () =>
      api<{ drivers: DiscoveredDriver[]; radiusKm: number }>(
        `/customer/drivers/nearby?lat=${center!.lat}&lng=${center!.lng}${vehicleType ? `&vehicleType=${vehicleType}` : ''}`,
      ),
  });

  const saveFavorite = useMutation({
    mutationFn: () =>
      api('/customer/favorites', {
        method: 'POST',
        body: { label: (pickupLabel.data?.label ?? 'Saved place').slice(0, 60), lat: center!.lat, lng: center!.lng },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['favorites'] }),
  });

  // One-tap call from the list: the server creates the lead + bills the driver, we dial.
  const callDriver = useMutation({
    mutationFn: (d: DiscoveredDriver) =>
      api<{ phone: string; leadId: string }>('/customer/calls', {
        method: 'POST',
        body: {
          driverId: d.driverId,
          pickup: center ? { lat: center.lat, lng: center.lng, address: pickupLabel.data?.label ?? undefined } : d.location,
          vehicleType: d.vehicleType,
        },
      }),
    onSuccess: (res) => {
      void Linking.openURL(`tel:${res.phone}`);
      router.push(`/lead/${res.leadId}`);
    },
  });

  // Live positions with heading for sprite rotation (spec §14).
  useEffect(() => {
    const drivers = nearby.data?.drivers ?? [];
    if (!drivers.length) return;
    void watchDrivers(drivers.map((d) => d.driverId));
    let mounted = true;
    void getSocket().then((s) => {
      s.off('driver:location');
      s.on('driver:location', (p: { driverId: string; lat: number; lng: number; heading?: number | null }) => {
        if (mounted) setLive((prev) => ({ ...prev, [p.driverId]: { lat: p.lat, lng: p.lng, heading: p.heading } }));
      });
      s.off('driver:presence');
      s.on('driver:presence', (p: { online: boolean }) => {
        if (!p.online) void nearby.refetch();
      });
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearby.data]);

  if (permission === 'denied') {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <Centered>
          <Title>Location needed</Title>
          <Muted center>Relax Go shows drivers near you, so it needs your location while you use the app.</Muted>
          <Button title="Allow location" onPress={locate} />
        </Centered>
      </SafeAreaView>
    );
  }

  const drivers = nearby.data?.drivers ?? [];

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        mapType={mapType}
        initialRegion={{ latitude: 20.4625, longitude: 85.8828, latitudeDelta: 6, longitudeDelta: 6 }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        onRegionChangeComplete={(r: Region) => {
          setCenter((prev) => {
            const next = { lat: r.latitude, lng: r.longitude };
            if (prev && Math.abs(prev.lat - next.lat) < 1e-5 && Math.abs(prev.lng - next.lng) < 1e-5) return prev;
            return next;
          });
        }}
      >
        {/* You are here — bold ringed dot that follows live GPS. */}
        {me ? <Marker coordinate={{ latitude: me.lat, longitude: me.lng }} anchor={{ x: 0.5, y: 0.5 }} image={ME_DOT} title="You are here" /> : null}
        {drivers.map((d) => {
          const pos = live[d.driverId] ?? d.location;
          const heading = live[d.driverId]?.heading ?? d.heading ?? 0;
          const sprite = SPRITES[d.vehicleType] ?? SPRITES.car!;
          return (
            // Native marker image: custom child views don't render under the new architecture.
            <Marker
              key={d.driverId}
              coordinate={{ latitude: pos.lat, longitude: pos.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              rotation={heading ?? 0}
              flat
              image={sprite.src}
              onPress={() => router.push(`/request/${d.driverId}`)}
            />
          );
        })}
      </MapView>

      {/* Fixed pickup pin at the map centre (map moves under it). */}
      <View pointerEvents="none" style={styles.centerPinWrap}>
        <View style={styles.pinHead}>
          <View style={styles.pinHeadInner} />
        </View>
        <View style={styles.pinStem} />
      </View>

      {/* Top bar: menu + pickup pill + favourite */}
      <SafeAreaView style={styles.topBar} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Menu" style={styles.iconBtn} onPress={() => setMenuOpen((v) => !v)}>
          <Ionicons name="menu" size={22} color={colors.ink} />
        </Pressable>
        <View style={styles.pickupPill}>
          {!center || pickupLabel.isPending ? (
            <ActivityIndicator size="small" color={colors.brand} />
          ) : (
            <View style={[styles.dot, { backgroundColor: colors.success }]} />
          )}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.text }}>
            {pickupText}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save this pickup to favourites"
            hitSlop={8}
            onPress={() => center && saveFavorite.mutate()}
          >
            <Ionicons name={saveFavorite.isSuccess ? 'heart' : 'heart-outline'} size={20} color={saveFavorite.isSuccess ? colors.danger : colors.faint} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Menu dropdown */}
      {menuOpen ? (
        <SafeAreaView style={styles.menuWrap} pointerEvents="box-none">
          <View style={styles.menuCard}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: colors.ink, paddingBottom: 6 }}>
              Relax <Text style={{ color: colors.accent }}>Go</Text>
            </Text>
            {(
              [
                ['time-outline', 'My activity', '/activity'],
                ['notifications-outline', 'Notifications', '/notifications'],
                ['help-buoy-outline', 'Support', '/support'],
                ['settings-outline', 'Settings & safety', '/settings'],
              ] as const
            ).map(([icon, label, href]) => (
              <Pressable
                key={href}
                accessibilityRole="button"
                style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: '#f1f5f9' }]}
                onPress={() => {
                  setMenuOpen(false);
                  router.push(href);
                }}
              >
                <Ionicons name={icon} size={18} color={colors.muted} />
                <Text style={{ fontSize: 15, color: colors.text, fontWeight: '600' }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </SafeAreaView>
      ) : null}

      {/* Satellite + my-location FABs */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle satellite view"
        style={[styles.locateFab, { bottom: listOpen ? 512 : 248 }]}
        onPress={toggleMapType}
      >
        <Ionicons name={mapType === 'standard' ? 'layers-outline' : 'map-outline'} size={20} color={colors.ink} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Center map on me"
        style={[styles.locateFab, { bottom: listOpen ? 456 : 192 }]}
        onPress={() => (me ? flyTo(me.lat, me.lng) : void locate())}
      >
        <Ionicons name="locate" size={20} color={colors.ink} />
      </Pressable>

      {/* Bottom: brand + drop bar + driver list (open by default) */}
      <View style={styles.bottomWrap}>
        <View style={styles.brandRow}>
          <Image source={LOGO} style={{ width: 22, height: 22 }} resizeMode="contain" />
          <Text style={styles.brandText}>
            Relax <Text style={{ color: colors.brand }}>Go</Text>
          </Text>
          <Text style={styles.brandSub}>· a ChefoTech product</Text>
        </View>
        <Pressable accessibilityRole="button" style={styles.dropBar} onPress={() => router.push('/destination')}>
          <View style={[styles.dot, { backgroundColor: colors.danger }]} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: destination ? '700' : '600', color: destination ? colors.text : colors.muted }}>
            {destination ? destination.label : 'Enter Drop Location'}
          </Text>
          {destination ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear destination" onPress={() => useTripComposer.getState().setDestination(null)} hitSlop={8}>
              <Text style={{ color: colors.faint, fontSize: 16 }}>✕</Text>
            </Pressable>
          ) : null}
        </Pressable>

        <Pressable accessibilityRole="button" style={styles.listToggle} onPress={() => setListOpen((v) => !v)}>
          {nearby.isPending || !center ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={colors.brand} />
              <Text style={{ fontWeight: '700', color: colors.brand, fontSize: 14 }}>Finding drivers near you…</Text>
            </View>
          ) : (
            <Text style={{ fontWeight: '700', color: colors.brand, fontSize: 14 }}>
              {drivers.length} driver{drivers.length === 1 ? '' : 's'} nearby
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Ionicons name={listOpen ? 'chevron-down' : 'chevron-up'} size={14} color={colors.brand} />
            <Text style={{ color: colors.brand, fontSize: 14 }}>{listOpen ? 'hide' : 'view list'}</Text>
          </View>
        </Pressable>

        {listOpen ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 6 }}>
              <FilterChip label="All" active={vehicleType === ''} onPress={() => setVehicleType('')} />
              {(config.data?.vehicleTypes ?? []).map((v) => (
                <FilterChip
                  key={v.key}
                  label={v.label}
                  icon={VEHICLE_MCI[v.key]}
                  active={vehicleType === v.key}
                  onPress={() => setVehicleType(v.key)}
                />
              ))}
            </View>
            {drivers.length === 0 ? (
              <Text style={styles.sheetInfo}>No drivers available nearby right now.</Text>
            ) : (
              <FlatList
                data={drivers}
                keyExtractor={(d) => d.driverId}
                style={{ maxHeight: 250 }}
                renderItem={({ item, index }) => (
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.driverRow, pressed && { backgroundColor: '#f8fafc' }]}
                    onPress={() => router.push(`/request/${item.driverId}`)}
                  >
                    <View style={styles.driverIcon}>
                      <Image source={(SPRITES[item.vehicleType] ?? SPRITES.car!).src} style={{ width: 20, height: 34 }} resizeMode="contain" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: colors.text, fontSize: 15 }} numberOfLines={1}>
                        {index + 1}. {item.name}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                        {item.vehicleModel ?? item.vehicleType}
                        {item.registrationNumber ? ` · ${item.registrationNumber}` : ''}
                      </Text>
                      <Text style={{ color: colors.faint, fontSize: 12 }}>
                        {etaMinutes(item.distanceKm)} min · {item.distanceKm} km · {item.rating.count ? `★ ${item.rating.average}` : 'New'}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${item.name}`}
                      style={styles.callBtn}
                      disabled={callDriver.isPending}
                      onPress={() => callDriver.mutate(item)}
                    >
                      <Ionicons name="call" size={15} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Call</Text>
                    </Pressable>
                  </Pressable>
                )}
              />
            )}
            {callDriver.isError ? (
              <Text style={[styles.sheetInfo, { color: colors.danger }]}>
                {callDriver.error instanceof Error ? callDriver.error.message : 'Could not start the call'}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

function FilterChip({ label, icon, active, onPress }: { label: string; icon?: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.chip, active && { backgroundColor: colors.brand }]}>
      {icon ? <MaterialCommunityIcons name={icon as never} size={16} color={active ? '#fff' : colors.muted} style={{ marginRight: 5 }} /> : null}
      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : colors.muted }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 8 },
  iconBtn: { backgroundColor: '#fff', width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  pickupPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: radius.pill, height: 52, paddingHorizontal: 16, ...shadow.card },
  dot: { width: 10, height: 10, borderRadius: 5 },
  menuWrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 64, paddingHorizontal: 14 },
  menuCard: { backgroundColor: '#fff', borderRadius: 16, padding: 12, width: 240, ...shadow.card },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
  centerPinWrap: { position: 'absolute', top: '50%', left: '50%', marginLeft: -14, marginTop: -46, alignItems: 'center' },
  pinHead: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', ...shadow.card },
  pinHeadInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  pinStem: { width: 3, height: 18, backgroundColor: colors.ink },
  locateFab: { position: 'absolute', right: 14, backgroundColor: '#fff', width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingBottom: 16, ...shadow.card },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 8 },
  brandText: { fontSize: 15, fontWeight: '900', color: colors.ink, letterSpacing: 0.3 },
  brandSub: { fontSize: 11, color: colors.faint, fontWeight: '600' },
  dropBar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, paddingHorizontal: 18, height: 58, borderRadius: 29, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.card },
  listToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  sheetInfo: { padding: 16, textAlign: 'center', color: colors.muted, fontSize: 14 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  driverIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.success, paddingHorizontal: 14, height: 40, borderRadius: 20 },
  chip: { flexDirection: 'row', paddingHorizontal: 12, height: 32, borderRadius: radius.pill, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
});
