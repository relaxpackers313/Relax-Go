import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Muted } from '@/components/ui';

interface NearbyResponse {
  me: { lat: number; lng: number } | null;
  radiusKm: number;
  drivers: { vehicleType: string; distanceKm: number; location: { lat: number; lng: number }; heading: number | null }[];
  customers: { location: { lat: number; lng: number }; vehicleType: string | null; minutesAgo: number }[];
}

const SPRITES: Record<string, number> = {
  car: require('../assets/vehicles/car.png'),
  auto: require('../assets/vehicles/auto.png'),
  bike: require('../assets/vehicles/bike.png'),
};
const ME_DOT = require('../assets/vehicles/me-dot.png');
const DEMAND_DOT = require('../assets/vehicles/demand-dot.png');

/**
 * Full-screen, fully draggable zone map: where YOU are, where the competition is,
 * and where customers searched in the last 30 minutes — pan and zoom freely.
 */
export default function ZoneScreen() {
  const mapRef = useRef<MapView>(null);
  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('standard');

  const nearby = useQuery({
    queryKey: ['driver-nearby'],
    queryFn: () => api<NearbyResponse>('/driver/nearby'),
    refetchInterval: 20_000,
  });

  const me = nearby.data?.me;

  if (!me) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Muted>{nearby.isPending ? 'Loading your zone…' : 'Go online once so we know your position, then check your zone.'}</Muted>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        mapType={mapType}
        initialRegion={{ latitude: me.lat, longitude: me.lng, latitudeDelta: 0.06, longitudeDelta: 0.06 }}
        showsCompass={false}
        toolbarEnabled={false}
      >
        <Marker coordinate={{ latitude: me.lat, longitude: me.lng }} anchor={{ x: 0.5, y: 0.5 }} image={ME_DOT} title="You are here" />
        {(nearby.data?.drivers ?? []).map((d, i) => (
          <Marker
            key={`peer-${i}`}
            coordinate={{ latitude: d.location.lat, longitude: d.location.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={d.heading ?? 0}
            image={SPRITES[d.vehicleType] ?? SPRITES.car!}
            title={`${d.vehicleType} driver`}
            description={`${d.distanceKm} km from you`}
          />
        ))}
        {(nearby.data?.customers ?? []).map((c, i) => (
          <Marker
            key={`cust-${i}`}
            coordinate={{ latitude: c.location.lat, longitude: c.location.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            image={DEMAND_DOT}
            title="Customer searched here"
            description={`${c.minutesAgo} min ago${c.vehicleType ? ` · wants ${c.vehicleType}` : ''}`}
          />
        ))}
      </MapView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle satellite view"
        style={[styles.fab, { top: 14, right: 14 }]}
        onPress={() => setMapType((t) => (t === 'standard' ? 'hybrid' : 'standard'))}
      >
        <Ionicons name={mapType === 'standard' ? 'layers-outline' : 'map-outline'} size={19} color={colors.ink} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Center on me"
        style={[styles.fab, { top: 70, right: 14 }]}
        onPress={() => mapRef.current?.animateToRegion({ latitude: me.lat, longitude: me.lng, latitudeDelta: 0.06, longitudeDelta: 0.06 }, 500)}
      >
        <Ionicons name="locate" size={19} color={colors.ink} />
      </Pressable>

      {/* Legend + live counts */}
      <View style={styles.legend}>
        <Text style={{ fontWeight: '800', color: colors.text, fontSize: 14, marginBottom: 6 }}>
          {(nearby.data?.drivers.length ?? 0)} driver{(nearby.data?.drivers.length ?? 0) === 1 ? '' : 's'} ·{' '}
          {(nearby.data?.customers.length ?? 0)} customer{(nearby.data?.customers.length ?? 0) === 1 ? '' : 's'} looking (last 30 min)
        </Text>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#2563EB' }]} />
            <Text style={styles.legendText}>You</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#F97316' }]} />
            <Text style={styles.legendText}>Customers searching</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#FFC531' }]} />
            <Text style={styles.legendText}>Other drivers</Text>
          </View>
        </View>
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
  legend: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 18,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
});
