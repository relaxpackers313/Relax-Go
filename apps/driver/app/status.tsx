import { Text } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, clearToken } from '@/lib/api';
import type { Me } from './_layout';
import { Button, Centered, Muted, Title } from '@/components/ui';

const COPY: Record<string, { title: string; body: string; emoji: string }> = {
  pending: { emoji: '⏳', title: 'Your registration is under review', body: 'The Relax Go team checks every driver personally. You will get a notification the moment you are approved — usually well within a working day.' },
  correction_required: { emoji: '✏️', title: 'Your registration requires changes', body: 'Something needs a fix before approval. Open the registration to see what and resubmit.' },
  rejected: { emoji: '❌', title: 'Your registration was not approved', body: 'See the reason below. You can correct and resubmit, or contact support if you think this is a mistake.' },
  suspended: { emoji: '🚫', title: 'Your account is suspended', body: 'You cannot take leads right now. Contact support to resolve this.' },
  blocked: { emoji: '🚫', title: 'Your account is blocked', body: 'Contact support if you believe this is an error.' },
};

export default function StatusScreen() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/driver/me'), refetchInterval: 15_000 });
  const status = me.data?.status ?? 'pending';
  const copy = COPY[status] ?? COPY.pending!;

  return (
    <Centered>
      <Text style={{ fontSize: 52 }}>{copy.emoji}</Text>
      <Title>{copy.title}</Title>
      <Muted center>{copy.body}</Muted>
      {me.data?.statusReason ? <Muted center>Reason: {me.data.statusReason}</Muted> : null}
      {['correction_required', 'rejected'].includes(status) ? <Button title="Fix my registration" onPress={() => router.replace('/onboarding')} /> : null}
      <Button title="Refresh status" variant="secondary" onPress={() => void me.refetch()} />
      <Button
        title="Sign out"
        variant="ghost"
        onPress={async () => {
          await clearToken();
          qc.clear();
          router.replace('/login');
        }}
      />
    </Centered>
  );
}
