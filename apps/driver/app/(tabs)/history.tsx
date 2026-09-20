import { FlatList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@relaxgo/shared';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Card, Muted, Pill } from '@/components/ui';

interface CallRow {
  _id: string;
  status: string;
  durationSeconds?: number;
  initiatedAt: string;
  billing: { classification: string; amountPaise: number };
}

/** Call history (spec §8): every tracked contact and what it cost. */
export default function HistoryScreen() {
  const q = useQuery({ queryKey: ['calls'], queryFn: () => api<{ items: CallRow[] }>('/driver/calls') });

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 10 }}
      data={q.data?.items ?? []}
      keyExtractor={(c) => c._id}
      ListEmptyComponent={
        <Muted center>{q.isPending ? 'Loading…' : q.isError ? 'Could not load history.' : 'No calls yet. Your customer calls appear here with what each one cost.'}</Muted>
      }
      renderItem={({ item }) => (
        <Card style={{ paddingVertical: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ fontWeight: '600', color: colors.text, fontSize: 14 }}>
                {new Date(item.initiatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {item.status.replace(/_/g, ' ')}
                {item.durationSeconds != null ? ` · ${item.durationSeconds}s` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Pill text={item.billing.classification} tone={item.billing.classification === 'free' ? 'good' : item.billing.classification === 'paid' ? 'warn' : 'default'} />
              {item.billing.amountPaise ? <Text style={{ fontWeight: '700', color: colors.text }}>{formatMoney(item.billing.amountPaise)}</Text> : null}
            </View>
          </View>
        </Card>
      )}
    />
  );
}
