import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Card, Centered, Muted, Pill, Title } from '@/components/ui';

interface LeadRow {
  _id: string;
  status: string;
  vehicleType: string;
  pickup: { address?: string };
  createdAt: string;
}

const TONE: Record<string, 'default' | 'good' | 'warn' | 'bad'> = {
  converted: 'good', contacted: 'good', accepted: 'good', rejected: 'bad', expired: 'bad', cancelled: 'default',
};

export default function ActivityScreen() {
  const q = useQuery({ queryKey: ['my-leads'], queryFn: () => api<{ items: LeadRow[] }>('/customer/leads') });

  if (q.isPending) return <Centered><Muted>Loading your activity…</Muted></Centered>;
  if (q.isError) return <Centered><Muted center>{q.error instanceof Error ? q.error.message : 'Could not load activity'}</Muted></Centered>;
  if (!q.data.items.length) {
    return (
      <Centered>
        <Title>No requests yet</Title>
        <Muted center>When you request a driver, your requests and their status live here.</Muted>
      </Centered>
    );
  }

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 10 }}
      data={q.data.items}
      keyExtractor={(l) => l._id}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/lead/${item._id}`)} accessibilityRole="button">
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>
                {item.pickup?.address ?? 'Pickup at map location'}
              </Text>
              <Pill text={item.status} tone={TONE[item.status] ?? 'default'} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
              {item.vehicleType} · {new Date(item.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Card>
        </Pressable>
      )}
    />
  );
}
