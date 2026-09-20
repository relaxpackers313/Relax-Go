import { Alert, Linking, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, clearToken } from '@/lib/api';
import { resetSocket } from '@/lib/socket';
import { stopTracking } from '@/lib/location';
import type { Me } from '../_layout';
import { Button, Card, Muted, Row, Title } from '@/components/ui';

interface PublicConfig {
  brand: { operator: string; company: string; supportPhone: string; supportWhatsapp: string; supportEmail: string };
}

export default function ProfileScreen() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/driver/me') });
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/config') });
  const d = me.data;
  const brand = cfg.data?.brand;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card style={{ gap: 4 }}>
        <Title>{d?.fullName ?? d?.phone ?? '—'}</Title>
        <Row label="Phone" value={d?.phone ?? '—'} />
        <Row label="Vehicle" value={d?.vehicleType ? `${d.vehicleType} · ${d.registrationNumber ?? ''}` : '—'} />
        <Row label="Rating" value={d?.rating?.count ? `${d.rating.average} ★ from ${d.rating.count} customers` : 'No ratings yet'} />
        <Row label="Status" value={d?.status ?? '—'} />
      </Card>

      <Card style={{ gap: 8 }}>
        <Title>Support</Title>
        <Muted>
          Relax Go is a {brand?.company ?? 'ChefoTech'} product operated by {brand?.operator ?? 'Relax Group'}. Lead, call, billing or document issues — we answer.
        </Muted>
        <Button title="Call support" variant="secondary" onPress={() => brand && void Linking.openURL(`tel:${brand.supportPhone.replace(/\s/g, '')}`)} />
        <Button title="WhatsApp support" variant="secondary" onPress={() => brand && void Linking.openURL(`https://wa.me/${brand.supportWhatsapp.replace(/\D/g, '')}`)} />
      </Card>

      <Card style={{ gap: 6 }}>
        <Title>Location & privacy</Title>
        <Muted>
          Your live location is shared ONLY while you are online — going offline stops it immediately, including the background service. Location history is kept for a limited period for support and safety, then deleted.
        </Muted>
      </Card>

      <Button
        title="Sign out"
        variant="secondary"
        onPress={() =>
          Alert.alert('Sign out?', 'You will stop receiving requests until you sign in again.', [
            { text: 'Stay', style: 'cancel' },
            {
              text: 'Sign out',
              style: 'destructive',
              onPress: async () => {
                await stopTracking().catch(() => undefined);
                await api('/driver/presence', { method: 'POST', body: { online: false } }).catch(() => undefined);
                await clearToken();
                resetSocket();
                qc.clear();
                router.replace('/login');
              },
            },
          ])
        }
      />
    </ScrollView>
  );
}
