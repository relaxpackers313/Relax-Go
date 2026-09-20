import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Button, Card, Input, Muted, Pill, Title } from '@/components/ui';

interface RegistrationState {
  status: string;
  statusReason: string | null;
  profileSubmitted: boolean;
  readyForReview: boolean;
  documents: { type: string; label: string; required: boolean; status: string; rejectionReason: string | null }[];
}

interface PublicConfig {
  vehicleTypes: { key: string; label: string }[];
}

/** Registration wizard (spec §9): profile + vehicle first, then each configured document. */
export default function OnboardingScreen() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['registration'], queryFn: () => api<RegistrationState>('/driver/registration') });
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/config') });

  const [form, setForm] = useState({ fullName: '', email: '', address: '', city: '', kinName: '', kinPhone: '', vehicleType: 'auto', registrationNumber: '', model: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = useMutation({
    mutationFn: () =>
      api('/driver/registration', {
        method: 'PUT',
        body: {
          fullName: form.fullName,
          email: form.email || undefined,
          address: form.address,
          city: form.city,
          emergencyContact: form.kinName ? { name: form.kinName, phone: form.kinPhone.startsWith('+') ? form.kinPhone : `+91${form.kinPhone}` } : undefined,
          vehicle: { type: form.vehicleType, registrationNumber: form.registrationNumber, model: form.model || undefined },
        },
      }),
    onSuccess: () => {
      setFieldErrors({});
      void qc.invalidateQueries({ queryKey: ['registration'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFieldErrors(e.fields);
      else Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again');
    },
  });

  const upload = useMutation({
    mutationFn: async (docType: string) => {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.7, base64: true });
      if (picked.canceled || !picked.assets[0]?.base64) return null;
      const asset = picked.assets[0];
      const { url } = await api<{ url: string }>('/driver/uploads', {
        method: 'POST',
        body: { base64: asset.base64, mimeType: asset.mimeType ?? 'image/jpeg' },
      });
      const needsExpiry = ['driving_licence', 'insurance'].includes(docType);
      return api('/driver/documents', {
        method: 'POST',
        body: { type: docType, fileUrl: url, ...(needsExpiry ? { expiresAt: '2030-01-01' } : {}) },
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['registration'] }),
    onError: (e) => Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again'),
  });

  if (state.isPending) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Muted>Loading…</Muted></View>;
  const reg = state.data!;
  const profileDone = reg.profileSubmitted;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      {reg.statusReason ? (
        <Card style={{ backgroundColor: '#fffbeb' }}>
          <Text style={{ color: '#92400e', fontSize: 13 }}>Requested changes: {reg.statusReason}</Text>
        </Card>
      ) : null}

      {!profileDone ? (
        <Card style={{ gap: 10 }}>
          <Title>1 · About you and your vehicle</Title>
          <Field error={fieldErrors.fullName}><Input placeholder="Full name (as on your licence)" value={form.fullName} onChangeText={(v) => setForm((f) => ({ ...f, fullName: v }))} /></Field>
          <Field error={fieldErrors.email}><Input placeholder="Email (optional, for receipts)" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} /></Field>
          <Field error={fieldErrors.address}><Input placeholder="Home address" value={form.address} onChangeText={(v) => setForm((f) => ({ ...f, address: v }))} /></Field>
          <Field error={fieldErrors.city}><Input placeholder="City" value={form.city} onChangeText={(v) => setForm((f) => ({ ...f, city: v }))} /></Field>
          <Field error={fieldErrors.emergencyContact}>
            <Input placeholder="Emergency contact name" value={form.kinName} onChangeText={(v) => setForm((f) => ({ ...f, kinName: v }))} />
          </Field>
          <Input placeholder="Emergency contact phone" keyboardType="phone-pad" value={form.kinPhone} onChangeText={(v) => setForm((f) => ({ ...f, kinPhone: v }))} />
          <Muted>Vehicle type</Muted>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(cfg.data?.vehicleTypes ?? [{ key: 'auto', label: 'Auto' }]).map((v) => (
              <Button key={v.key} title={v.label} variant={form.vehicleType === v.key ? 'primary' : 'secondary'} style={{ flex: 1, height: 40 }} onPress={() => setForm((f) => ({ ...f, vehicleType: v.key }))} />
            ))}
          </View>
          <Field error={fieldErrors['vehicle.registrationNumber']}>
            <Input placeholder="Vehicle number (e.g. OD05AB1234)" autoCapitalize="characters" value={form.registrationNumber} onChangeText={(v) => setForm((f) => ({ ...f, registrationNumber: v }))} />
          </Field>
          <Input placeholder="Vehicle model (optional)" value={form.model} onChangeText={(v) => setForm((f) => ({ ...f, model: v }))} />
          <Button title="Save & continue to documents" loading={submit.isPending} onPress={() => submit.mutate()} />
        </Card>
      ) : (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title>2 · Your documents</Title>
            <Pill text={reg.readyForReview ? 'all uploaded' : 'incomplete'} tone={reg.readyForReview ? 'good' : 'warn'} />
          </View>
          <Muted>Take clear photos — blurred documents are the most common reason for correction requests.</Muted>
          {reg.documents.map((doc) => (
            <View key={doc.type} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: colors.text, fontSize: 14 }}>
                  {doc.label}
                  {doc.required ? ' *' : ''}
                </Text>
                {doc.rejectionReason ? <Text style={{ color: colors.danger, fontSize: 12 }}>{doc.rejectionReason}</Text> : null}
              </View>
              <Pill
                text={doc.status}
                tone={doc.status === 'verified' ? 'good' : doc.status === 'rejected' ? 'bad' : doc.status === 'missing' ? 'default' : 'warn'}
              />
              {doc.status === 'missing' || doc.status === 'rejected' ? (
                <Button title="Upload" variant="secondary" style={{ height: 34, paddingHorizontal: 10 }} onPress={() => upload.mutate(doc.type)} />
              ) : null}
            </View>
          ))}
          {reg.readyForReview ? (
            <>
              <Muted>Everything is in — your registration is with the Relax Go team for review. You will be notified as soon as it is approved.</Muted>
              <Button title="Check status" onPress={() => router.replace('/status')} />
            </>
          ) : null}
        </Card>
      )}
    </ScrollView>
  );
}

function Field({ children, error }: { children: React.ReactNode; error?: string }) {
  return (
    <View>
      {children}
      {error ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 3 }}>{error}</Text> : null}
    </View>
  );
}
