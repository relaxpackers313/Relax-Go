import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Button, Card, Input, Muted, Pill, Title } from '@/components/ui';

interface Ticket {
  _id: string;
  subject: string;
  status: string;
  category: string;
  messages: { from: { kind: string }; body: string; at: string }[];
}

export default function SupportScreen() {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => api<{ items: Ticket[] }>('/support') });

  const create = useMutation({
    mutationFn: () => api('/support', { method: 'POST', body: { category: 'general', subject, body } }),
    onSuccess: () => {
      setSubject('');
      setBody('');
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 12 }}
      ListHeaderComponent={
        <Card style={{ gap: 10 }}>
          <Title>Report an issue</Title>
          <Input placeholder="What is it about?" value={subject} onChangeText={setSubject} />
          <Input placeholder="Tell us what happened" value={body} onChangeText={setBody} multiline style={{ height: 90, textAlignVertical: 'top', paddingTop: 10 }} />
          {create.isError ? <Text style={{ color: colors.danger, fontSize: 13 }}>{create.error instanceof Error ? create.error.message : 'Failed'}</Text> : null}
          <Button title="Send to support" loading={create.isPending} disabled={subject.trim().length < 3 || body.trim().length < 3} onPress={() => create.mutate()} />
        </Card>
      }
      data={q.data?.items ?? []}
      keyExtractor={(t) => t._id}
      ListEmptyComponent={q.isPending ? <Muted center>Loading…</Muted> : <Muted center>No previous tickets.</Muted>}
      renderItem={({ item }) => (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>{item.subject}</Text>
            <Pill text={item.status} tone={item.status === 'resolved' ? 'good' : 'default'} />
          </View>
          {item.messages.slice(-2).map((m, i) => (
            <Text key={i} style={{ color: m.from.kind === 'admin' ? colors.brand : colors.muted, fontSize: 13, marginTop: 4 }}>
              {m.from.kind === 'admin' ? 'Support: ' : 'You: '}{m.body}
            </Text>
          ))}
        </Card>
      )}
    />
  );
}
