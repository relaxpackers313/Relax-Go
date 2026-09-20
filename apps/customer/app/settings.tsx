import { Alert, Linking, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Button, Card, Muted, Row, Title } from '@/components/ui';

interface PublicConfig {
  brand: { productName: string; company: string; operator: string; supportPhone: string; supportWhatsapp: string; supportEmail: string; headOfficeAddress: string };
  safety: { sosEnabled: boolean; sosNumbers: string[]; tripSharingEnabled: boolean };
}

/** Settings, safety and privacy (spec §36, §65): SOS, support contacts, plain-words privacy, session reset. */
export default function SettingsScreen() {
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/config') });
  const brand = cfg.data?.brand;
  const safety = cfg.data?.safety;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      {safety?.sosEnabled ? (
        <Card style={{ backgroundColor: '#fef2f2', gap: 8 }}>
          <Title>Emergency</Title>
          <Muted>In an emergency, call the national emergency number directly. Relax Go opens your phone dialer — the call is made by you.</Muted>
          {safety.sosNumbers.map((n) => (
            <Button key={n} title={`Call ${n}`} variant="danger" onPress={() => void Linking.openURL(`tel:${n}`)} />
          ))}
        </Card>
      ) : null}

      <Card style={{ gap: 8 }}>
        <Title>Support</Title>
        {brand ? (
          <>
            <Row label="Operated by" value={`${brand.operator} (a ${brand.company} product)`} />
            <Row label="Phone" value={brand.supportPhone} />
            <Row label="Email" value={brand.supportEmail} />
            <Row label="Office" value={brand.headOfficeAddress} />
          </>
        ) : (
          <Muted>Loading contact details…</Muted>
        )}
        <Button title="Call support" variant="secondary" onPress={() => brand && void Linking.openURL(`tel:${brand.supportPhone.replace(/\s/g, '')}`)} />
        <Button title="WhatsApp support" variant="secondary" onPress={() => brand && void Linking.openURL(`https://wa.me/${brand.supportWhatsapp.replace(/\D/g, '')}`)} />
        <Button title="Report an issue in-app" variant="secondary" onPress={() => router.push('/support')} />
      </Card>

      <Card style={{ gap: 6 }}>
        <Title>Your privacy</Title>
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
          • No account is needed — you use Relax Go through an anonymous session on this device.{'\n'}
          • Your location is used only while the app is open, to show nearby drivers and set your pickup.{'\n'}
          • Your phone number is stored only after you share it for a request, and drivers receive it only through a tracked call.{'\n'}
          • Deleting the session below removes this device's identity; past requests are no longer linked to you on this phone.
        </Text>
        <Button
          title="Delete my session from this device"
          variant="secondary"
          onPress={() =>
            Alert.alert('Delete session?', 'Your request history will no longer be visible on this device.', [
              { text: 'Keep it', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await SecureStore.deleteItemAsync('relaxgo_session_token');
                  Alert.alert('Done', 'A fresh session will start next time you open the app.');
                },
              },
            ])
          }
        />
      </Card>
    </ScrollView>
  );
}
