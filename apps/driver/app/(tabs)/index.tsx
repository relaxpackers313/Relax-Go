import { useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, RefreshControl, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { requestLocationPermissions, startTracking, stopTracking, isTracking } from '@/lib/location';
import { registerPushToken } from '@/lib/push';
import { colors, radius, shadow } from '@/lib/theme';
import { Card, Muted, Pill, Title } from '@/components/ui';
import type { Me } from '../_layout';

interface LeadRow {
  _id: string;
  status: string;
  distanceKm: number;
  vehicleType: string;
  pickup: { address?: string };
  requirements?: string;
  createdAt: string;
  expiresAt: string;
}

interface PublicConfig {
  brand: { productName: string };
  discovery: { defaultRadiusKm: number };
  maps?: { tileUrl: string; tileAttribution: string };
}

interface NearbyResponse {
  me: { lat: number; lng: number } | null;
  radiusKm: number;
  drivers: { vehicleType: string; distanceKm: number; location: { lat: number; lng: number }; heading: number | null }[];
  customers: { location: { lat: number; lng: number }; vehicleType: string | null; minutesAgo: number }[];
}

const SPRITES: Record<string, { src: number; w: number; h: number }> = {
  car: { src: require('../../assets/vehicles/car.png'), w: 24, h: 44 },
  auto: { src: require('../../assets/vehicles/auto.png'), w: 25, h: 44 },
  bike: { src: require('../../assets/vehicles/bike.png'), w: 17, h: 44 },
};
const ME_DOT = require('../../assets/vehicles/me-dot.png');
const DEMAND_DOT = require('../../assets/vehicles/demand-dot.png');

/** Driver home (spec §58): one switch to go online, then the incoming leads — nothing else in the way. */
export default function DriverHome() {
  const qc = useQueryClient();
  const [online, setOnline] = useState(false);
  const [switching, setSwitching] = useState(false);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/driver/me') });
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/config') });

  // Zone awareness: other online drivers around me (anonymous — density only).
  const nearby = useQuery({
    queryKey: ['driver-nearby'],
    queryFn: () => api<NearbyResponse>('/driver/nearby'),
    refetchInterval: online ? 20_000 : 60_000,
  });

  void cfg;

  const leads = useQuery({
    queryKey: ['driver-leads'],
    queryFn: () => api<{ items: LeadRow[] }>('/driver/leads'),
    refetchInterval: online ? 15_000 : false,
  });

  useEffect(() => {
    void registerPushToken();
    void isTracking().then(setOnline);
    let mounted = true;
    void getSocket().then((s) => {
      if (!s || !mounted) return;
      s.on('lead:new', () => {
        void qc.invalidateQueries({ queryKey: ['driver-leads'] });
      });
      s.on('notification', () => void qc.invalidateQueries({ queryKey: ['me'] }));
    });
    return () => {
      mounted = false;
    };
  }, [qc]);

  const presence = useMutation({
    mutationFn: (value: boolean) => api('/driver/presence', { method: 'POST', body: { online: value } }),
  });

  async function toggleOnline(value: boolean) {
    setSwitching(true);
    try {
      if (value) {
        const perms = await requestLocationPermissions();
        if (!perms.foreground) {
          Alert.alert('Location needed', 'Customers find you by your live location. Allow location access to go online.');
          return;
        }
        if (!perms.background) {
          Alert.alert(
            'Allow background location',
            'Choose "Allow all the time" so customers can still find you when your screen is off. You can go online with foreground-only access, but you will drop off the map whenever the app is minimized.',
          );
        }
        const cfg = await api<{ location?: { foregroundIntervalSeconds: number; backgroundIntervalSeconds: number } }>('/config').catch(() => ({}) as never);
        await startTracking({
          foregroundIntervalSeconds: cfg.location?.foregroundIntervalSeconds ?? 5,
          backgroundIntervalSeconds: cfg.location?.backgroundIntervalSeconds ?? 15,
        });
        await presence.mutateAsync(true);
        setOnline(true);
      } else {
        await presence.mutateAsync(false);
        await stopTracking();
        setOnline(false);
      }
    } catch (err) {
      Alert.alert('Could not change status', err instanceof Error ? err.message : 'Try again');
    } finally {
      setSwitching(false);
    }
  }

  const wallet = me.data?.wallet;
  const activeLeads = (leads.data?.items ?? []).filter((l) => ['created', 'shown', 'viewed', 'accepted', 'contacted'].includes(l.status));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Relax Go brand header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: colors.ink }}>
            Relax <Text style={{ color: colors.brand }}>Go</Text>
          </Text>
          <View style={{ backgroundColor: colors.ink, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>DRIVER</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Notifications" onPress={() => router.push('/notifications')} hitSlop={8}>
          <Ionicons name="notifications-outline" size={22} color={colors.ink} />
        </Pressable>
      </View>

      {/* Online switch */}
      <View style={[{ margin: 16, marginBottom: 10, padding: 16, borderRadius: radius.card, backgroundColor: online ? colors.brand : colors.ink }, shadow.card]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>{online ? 'You are ONLINE' : 'You are offline'}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 }}>
              {online ? 'Customers nearby can see you and send requests.' : 'Go online to appear to customers near you.'}
            </Text>
          </View>
          <Switch value={online} disabled={switching} onValueChange={(v) => void toggleOnline(v)} trackColor={{ true: '#134e4a', false: '#334155' }} thumbColor="#fff" />
        </View>
        {wallet ? (
          <Pressable onPress={() => router.push('/(tabs)/wallet')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 }}>
            <Text style={{ color: '#fff', fontSize: 12 }}>Free credits: <Text style={{ fontWeight: '800' }}>{wallet.freeCredits + wallet.promoCredits}</Text></Text>
            <Text style={{ color: '#fff', fontSize: 12 }}>Wallet: <Text style={{ fontWeight: '800' }}>₹{(wallet.balancePaise / 100).toFixed(0)}</Text></Text>
            {me.data?.today ? (
              <Text style={{ color: '#fff', fontSize: 12 }}>
                Today: <Text style={{ fontWeight: '800' }}>{me.data.today.calls} calls</Text>
                {me.data.today.freeCallsPerDay > 0 ? <> · free left: <Text style={{ fontWeight: '800' }}>{me.data.today.freeCallsRemaining}/{me.data.today.freeCallsPerDay}</Text></> : null}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>

      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 10 }}
        data={activeLeads}
        keyExtractor={(l) => l._id}
        refreshControl={<RefreshControl refreshing={leads.isRefetching} onRefresh={() => void leads.refetch()} />}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            {/* OFFLINE: show what the driver is missing — live demand + competition — with one CTA. */}
            {!online && nearby.data ? (
              <View style={[{ borderRadius: radius.card, backgroundColor: '#7C2D12', padding: 16 }, shadow.card]}>
                <Text style={{ color: '#FDBA74', fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>WHILE YOU WERE OFFLINE</Text>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 6, lineHeight: 23 }}>
                  {nearby.data.customers.length > 0
                    ? `${nearby.data.customers.length} customer${nearby.data.customers.length === 1 ? '' : 's'} searched for a ride near you in the last 30 minutes`
                    : 'Customers search for rides in your area all day'}
                  {nearby.data.drivers.length > 0
                    ? ` — and ${nearby.data.drivers.length} other driver${nearby.data.drivers.length === 1 ? ' is' : 's are'} online taking those calls right now.`
                    : ' — and right now there is NO other driver online to take them.'}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 6 }}>
                  Every call you miss is income going to someone else. Go online and start earning.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  style={{ marginTop: 12, height: 46, borderRadius: 23, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
                  disabled={switching}
                  onPress={() => void toggleOnline(true)}
                >
                  <Ionicons name="flash" size={17} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>{switching ? 'Going online…' : 'Go online now'}</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Your zone: competitor traffic + live demand around your live position. */}
            {nearby.data?.me ? (
              <View style={[{ borderRadius: radius.card, backgroundColor: '#fff', overflow: 'hidden' }, shadow.card]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open the full zone map"
                  onPress={() => router.push('/zone')}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 }}
                >
                  <Text style={{ fontWeight: '700', color: colors.text, fontSize: 15 }}>Your zone</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                      {nearby.data
                        ? `${nearby.data.drivers.length} driver${nearby.data.drivers.length === 1 ? '' : 's'} · ${nearby.data.customers.length} looking`
                        : 'Locating…'}
                    </Text>
                    <Ionicons name="expand-outline" size={16} color={colors.brand} />
                  </View>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Open the full zone map" onPress={() => router.push('/zone')}>
                  <MapView
                    style={{ height: 230 }}
                    provider={PROVIDER_GOOGLE}
                    region={{ latitude: nearby.data.me.lat, longitude: nearby.data.me.lng, latitudeDelta: 0.06, longitudeDelta: 0.06 }}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    rotateEnabled={false}
                    pitchEnabled={false}
                    toolbarEnabled={false}
                    pointerEvents="none"
                  >
                    {/* Native marker images — custom child views don't render under the new architecture. */}
                    <Marker coordinate={{ latitude: nearby.data.me.lat, longitude: nearby.data.me.lng }} anchor={{ x: 0.5, y: 0.5 }} image={ME_DOT} />
                    {nearby.data.drivers.map((d, i) => (
                      <Marker
                        key={`peer-${i}`}
                        coordinate={{ latitude: d.location.lat, longitude: d.location.lng }}
                        anchor={{ x: 0.5, y: 0.5 }}
                        flat
                        rotation={d.heading ?? 0}
                        image={(SPRITES[d.vehicleType] ?? SPRITES.car!).src}
                      />
                    ))}
                    {nearby.data.customers.map((c, i) => (
                      <Marker key={`cust-${i}`} coordinate={{ latitude: c.location.lat, longitude: c.location.lng }} anchor={{ x: 0.5, y: 0.5 }} image={DEMAND_DOT} />
                    ))}
                  </MapView>
                </Pressable>
                <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.brand, fontWeight: '700' }}>Tap the map to explore your zone — pan, zoom, satellite</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#2563EB' }} />
                    <Text style={{ fontSize: 11, color: colors.muted }}>You</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#F97316' }} />
                    <Text style={{ fontSize: 11, color: colors.muted }}>Customers searching</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#FFC531' }} />
                    <Text style={{ fontSize: 11, color: colors.muted }}>Other drivers</Text>
                  </View>
                </View>
              </View>
            ) : null}
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>Customer requests</Text>
          </View>
        }
        ListEmptyComponent={
          <Card>
            {leads.isPending ? (
              <Muted>Loading requests…</Muted>
            ) : online ? (
              <Muted>No requests right now. Stay online — new requests appear here instantly and you also get a notification.</Muted>
            ) : (
              <Muted>You are offline, so customers cannot send you requests.</Muted>
            )}
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/lead/${item._id}`)} accessibilityRole="button">
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Title>{item.pickup?.address ?? 'Pickup on map'}</Title>
                <Pill text={item.status} tone={item.status === 'accepted' || item.status === 'contacted' ? 'good' : 'warn'} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
                {item.distanceKm ? `${item.distanceKm} km from you · ` : ''}
                {item.vehicleType} · expires {new Date(item.expiresAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </Text>
              {item.requirements ? <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }}>"{item.requirements}"</Text> : null}
            </Card>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
