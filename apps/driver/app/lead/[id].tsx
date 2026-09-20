import { useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { formatMoney } from '@relaxgo/shared';
import { api, ApiError } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Button, Card, Muted, Pill, Row, Title } from '@/components/ui';

interface LeadDetail {
  _id: string;
  status: string;
  distanceKm: number;
  vehicleType: string;
  requirements?: string;
  pickup: { location: { coordinates: [number, number] }; address?: string };
  destination?: { location: { coordinates: [number, number] }; address?: string };
  createdAt: string;
  expiresAt: string;
}

interface Trip {
  _id: string;
  status: string;
}

/**
 * The driver's lead screen (spec §58): where the customer is, how far, what calling costs,
 * one button to call — number revealed only through the tracked call — then the trip lifecycle.
 */
export default function DriverLeadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [lastCharge, setLastCharge] = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['driver-lead', id],
    queryFn: async () => {
      const res = await api<{ items: LeadDetail[] }>(`/driver/leads`);
      const lead = res.items.find((l) => l._id === id);
      if (!lead) throw new ApiError(404, 'gone', 'This request is no longer available');
      return lead;
    },
    refetchInterval: 20_000,
  });

  const trip = useQuery({
    queryKey: ['driver-trips'],
    queryFn: () => api<{ items: (Trip & { leadId: string })[] }>('/driver/trips'),
    select: (data) => data.items.find((t) => t.leadId === id) ?? null,
  });

  const act = useMutation({
    mutationFn: (action: 'viewed' | 'accept' | 'reject') => api(`/driver/leads/${id}/action`, { method: 'POST', body: { action } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['driver-lead', id] }),
    onError: (e) => Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again'),
  });

  const call = useMutation({
    mutationFn: () => api<{ callId: string; phone: string; charge: { message: string } }>('/driver/calls', { method: 'POST', body: { leadId: id } }),
    onSuccess: async (res) => {
      setLastCharge(res.charge.message);
      setActiveCallId(res.callId);
      await Linking.openURL(`tel:${res.phone}`);
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['driver-lead', id] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 402) {
        Alert.alert('No call credits', e.message, [{ text: 'OK' }]);
      } else {
        Alert.alert('Call failed', e instanceof Error ? e.message : 'Try again');
      }
    },
  });

  const outcome = useMutation({
    mutationFn: (status: 'connected' | 'no_answer') => api(`/driver/calls/${activeCallId}/outcome`, { method: 'POST', body: { status } }),
    onSuccess: () => setActiveCallId(null),
  });

  const startTrip = useMutation({
    mutationFn: () => api<Trip>(`/driver/trips/from-lead/${id}`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['driver-trips'] });
      void qc.invalidateQueries({ queryKey: ['driver-lead', id] });
    },
    onError: (e) => Alert.alert('Could not confirm trip', e instanceof Error ? e.message : 'Try again'),
  });

  const tripAction = useMutation({
    mutationFn: (action: string) => api(`/driver/trips/${trip.data!._id}/action`, { method: 'POST', body: { action } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['driver-trips'] }),
  });

  if (q.isPending) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Muted>Loading request…</Muted></View>;
  if (q.isError) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Muted>{q.error instanceof Error ? q.error.message : 'Not found'}</Muted></View>;

  const lead = q.data;
  const [lng, lat] = lead.pickup.location.coordinates;
  const open = ['created', 'shown', 'viewed', 'accepted', 'contacted'].includes(lead.status);
  const NEXT_TRIP_ACTION: Record<string, { action: string; label: string }> = {
    driver_confirmed: { action: 'en_route', label: 'I am on my way' },
    driver_en_route: { action: 'arrived', label: 'I have arrived' },
    arrived: { action: 'start', label: 'Start trip' },
    started: { action: 'complete', label: 'Complete trip' },
  };
  const nextTrip = trip.data ? NEXT_TRIP_ACTION[trip.data.status] : undefined;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card style={{ padding: 0, overflow: 'hidden', height: 200 }}>
        <MapView
          style={{ flex: 1 }}
          provider={PROVIDER_GOOGLE}
          initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
          toolbarEnabled={false}
        >
          <Marker coordinate={{ latitude: lat, longitude: lng }} />
        </MapView>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title>Customer request</Title>
          <Pill text={trip.data ? `trip: ${trip.data.status.replace(/_/g, ' ')}` : lead.status} tone={open || trip.data ? 'good' : 'default'} />
        </View>
        <View style={{ height: 6 }} />
        <Row label="Pickup" value={lead.pickup.address ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`} />
        {lead.destination ? <Row label="Destination" value={lead.destination.address ?? 'On map'} /> : null}
        <Row label="Distance from you" value={lead.distanceKm ? `${lead.distanceKm} km` : '—'} />
        <Row label="Vehicle asked" value={lead.vehicleType} />
        {lead.requirements ? <Row label="Note" value={lead.requirements} /> : null}
        <Row label="Expires" value={new Date(lead.expiresAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} />
      </Card>

      {lastCharge ? <Muted center>{lastCharge}</Muted> : null}

      {activeCallId ? (
        <Card style={{ gap: 8 }}>
          <Title>How did the call go?</Title>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Connected" style={{ flex: 1 }} onPress={() => outcome.mutate('connected')} />
            <Button title="No answer" variant="secondary" style={{ flex: 1 }} onPress={() => outcome.mutate('no_answer')} />
          </View>
        </Card>
      ) : null}

      {open ? (
        <View style={{ gap: 8 }}>
          <Button title="📞 Call customer" loading={call.isPending} onPress={() => call.mutate()} />
          {['created', 'shown', 'viewed'].includes(lead.status) ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Accept" variant="secondary" style={{ flex: 1 }} loading={act.isPending} onPress={() => act.mutate('accept')} />
              <Button title="Decline" variant="ghost" style={{ flex: 1 }} onPress={() => act.mutate('reject')} />
            </View>
          ) : null}
          {['accepted', 'contacted'].includes(lead.status) && !trip.data ? (
            <Button title="Confirm trip with customer" variant="secondary" loading={startTrip.isPending} onPress={() => startTrip.mutate()} />
          ) : null}
        </View>
      ) : null}

      {nextTrip ? <Button title={nextTrip.label} loading={tripAction.isPending} onPress={() => tripAction.mutate(nextTrip.action)} /> : null}
      {trip.data && !['completed', 'cancelled'].includes(trip.data.status) ? (
        <Button title="Cancel trip" variant="ghost" onPress={() => tripAction.mutate('cancel')} />
      ) : null}
    </ScrollView>
  );
}
