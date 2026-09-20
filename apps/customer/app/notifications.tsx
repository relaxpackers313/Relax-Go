import { useEffect } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Card, Centered, Muted } from '@/components/ui';

interface Notice {
  _id: string;
  type: string;
  title: string;
  body?: string;
  readAt?: string;
  createdAt: string;
}

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => api<{ items: Notice[]; unread: number }>('/notifications') });

  // Opening the inbox marks everything read.
  useEffect(() => {
    if (q.data?.unread) {
      void api('/notifications/read', { method: 'POST', body: {} }).then(() => qc.invalidateQueries({ queryKey: ['inbox'] }));
    }
  }, [q.data?.unread, qc]);

  if (q.isPending) return <Centered><Muted>Loading…</Muted></Centered>;
  if (q.isError) return <Centered><Muted center>Could not load notifications.</Muted></Centered>;
  if (!q.data.items.length) {
    return (
      <Centered>
        <Text style={{ fontSize: 40 }}>🔕</Text>
        <Muted center>Nothing yet. Updates about your requests land here.</Muted>
      </Centered>
    );
  }

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={q.data.items}
      keyExtractor={(n) => n._id}
      renderItem={({ item }) => (
        <Card style={{ opacity: item.readAt ? 0.75 : 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }}>{item.title}</Text>
            {!item.readAt ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginTop: 5 }} /> : null}
          </View>
          {item.body ? <Text style={{ color: colors.muted, fontSize: 13, marginTop: 3 }}>{item.body}</Text> : null}
          <Text style={{ color: colors.faint, fontSize: 11, marginTop: 5 }}>
            {new Date(item.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </Text>
        </Card>
      )}
    />
  );
}
