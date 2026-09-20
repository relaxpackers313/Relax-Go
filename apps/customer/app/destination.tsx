import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useTripComposer, type PickedPlace } from '@/lib/trip-store';
import { colors } from '@/lib/theme';
import { Card, Input, Muted } from '@/components/ui';

interface GeoResult {
  label: string;
  lat: number;
  lng: number;
}

/** Destination picker: live search (server-side geocoding), saved places and recents (spec §4). */
export default function DestinationScreen() {
  const qc = useQueryClient();
  const setDestination = useTripComposer((s) => s.setDestination);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    void Location.getLastKnownPositionAsync().then((pos) => {
      if (pos) setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const search = useQuery({
    queryKey: ['geo', debounced, here?.lat],
    enabled: debounced.length >= 2,
    queryFn: () =>
      api<{ results: GeoResult[] }>(
        `/customer/geo/search?q=${encodeURIComponent(debounced)}${here ? `&lat=${here.lat}&lng=${here.lng}` : ''}`,
      ),
  });

  const favorites = useQuery({ queryKey: ['favorites'], queryFn: () => api<{ items: (GeoResult & { address?: string })[] }>('/customer/favorites') });
  const recents = useQuery({ queryKey: ['recents'], queryFn: () => api<{ items: GeoResult[] }>('/customer/recents') });

  const addFavorite = useMutation({
    mutationFn: (place: PickedPlace) => api('/customer/favorites', { method: 'POST', body: { label: place.label.slice(0, 60), lat: place.lat, lng: place.lng } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['favorites'] }),
  });

  function pick(place: PickedPlace) {
    setDestination(place);
    router.back();
  }

  const searchResults = search.data?.results ?? [];
  const showingSearch = debounced.length >= 2;

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Input placeholder="Search a place, landmark or area…" autoFocus value={q} onChangeText={setQ} />
      {showingSearch ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {search.isPending ? (
            <Muted center>Searching…</Muted>
          ) : searchResults.length === 0 ? (
            <View style={{ padding: 14 }}>
              <Muted center>No places found. Try a nearby landmark.</Muted>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(r, i) => `${r.lat}-${r.lng}-${i}`}
              renderItem={({ item }) => (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable accessibilityRole="button" style={{ flex: 1, padding: 14 }} onPress={() => pick(item)}>
                    <Text style={{ color: colors.text, fontSize: 14 }} numberOfLines={2}>
                      📍 {item.label}
                    </Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Save to favourites" hitSlop={8} style={{ padding: 14 }} onPress={() => addFavorite.mutate(item)}>
                    <Text style={{ fontSize: 16 }}>☆</Text>
                  </Pressable>
                </View>
              )}
            />
          )}
        </Card>
      ) : (
        <FlatList
          data={[
            ...(favorites.data?.items ?? []).map((f) => ({ ...f, kind: 'favorite' as const })),
            ...(recents.data?.items ?? []).map((r) => ({ ...r, kind: 'recent' as const })),
          ]}
          keyExtractor={(r, i) => `${r.kind}-${i}`}
          ListHeaderComponent={
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 15, marginBottom: 8 }}>Saved & recent places</Text>
          }
          ListEmptyComponent={
            <Card>
              <Muted>
                Your saved places and recent pickups will appear here. Search above and tap ☆ to save home, work or the stand you use daily.
              </Muted>
            </Card>
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => pick(item)}>
              <Card style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 18 }}>{item.kind === 'favorite' ? '⭐' : '🕘'}</Text>
                <Text style={{ flex: 1, color: colors.text, fontSize: 14 }} numberOfLines={2}>
                  {item.label}
                </Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
