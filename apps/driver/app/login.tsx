import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { passwordLogin, passwordSignup, startPhoneSignIn, exchangeForSession, type DriverSession, type PhoneSignIn } from '@/lib/auth';
import { Button } from '@/components/ui';

const LOGO = require('../assets/splash-logo.png');
// The Relax Go logo is orange — this screen leans on it, Swiggy-style.
const ORANGE = '#F25C24';
const INK = '#1c1c1c';
const MUTED = '#8a8a8a';
const FIELD_BG = '#F4F4F5';
const FIELD_BORDER = '#E8E8EA';

function Field({
  label,
  prefix,
  secure,
  ...props
}: TextInputProps & { label: string; prefix?: string; secure?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>
        {prefix ? (
          <>
            <Text style={styles.prefix}>{prefix}</Text>
            <View style={styles.vline} />
          </>
        ) : null}
        <TextInput
          placeholderTextColor="#b9b9bd"
          {...props}
          secureTextEntry={secure ? !show : false}
          style={styles.fieldInput}
        />
        {secure ? (
          <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} hitSlop={10} onPress={() => setShow((v) => !v)}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={MUTED} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Driver Login / Sign Up in the classic food-and-ride app layout: brand top-left, big heading,
 * labelled light fields, one accent button, footer link that swaps between the two pages.
 */
export default function LoginScreen() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['auth-mode'], queryFn: () => api<{ auth: { driverAuthMode: 'phone_password' | 'firebase' } }>('/config') });
  const mode = cfg.data?.auth.driverAuthMode ?? 'phone_password';

  const [page, setPage] = useState<'login' | 'signup'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [confirmer, setConfirmer] = useState<Extract<PhoneSignIn, { kind: 'firebase' }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, '');
  const fullPhone = phone.startsWith('+') ? phone : `+91${digits}`;
  const phoneOk = digits.length >= 10;
  const isSignup = page === 'signup';

  async function finish(session: DriverSession) {
    await qc.invalidateQueries({ queryKey: ['me'] });
    if (session.driver.status === 'approved') router.replace('/(tabs)');
    else if (!session.driver.registrationSubmitted) router.replace('/onboarding');
    else router.replace('/status');
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const switchPage = (to: 'login' | 'signup') => {
    setPage(to);
    setError(null);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 18 }} keyboardShouldPersistTaps="handled">
          {/* Brand — top left, Swiggy style */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Image source={LOGO} style={{ width: 30, height: 30 }} resizeMode="contain" />
            <Text style={{ fontSize: 19, fontWeight: '900', color: ORANGE, letterSpacing: 1.5 }}>RELAX GO</Text>
            <View style={{ backgroundColor: INK, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1.5 }}>
              <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 }}>DRIVER</Text>
            </View>
          </View>

          {/* Heading */}
          <Text style={styles.heading}>{isSignup ? 'Sign Up' : 'Login'}</Text>
          <Text style={styles.sub}>{isSignup ? 'And start earning today.' : 'Welcome to Relax Go Driver.'}</Text>

          <View style={styles.hr} />

          {mode === 'phone_password' ? (
            <View style={{ gap: 16 }}>
              <Field
                label="Phone Number"
                prefix="+91"
                placeholder="Enter the phone number"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                maxLength={13}
              />
              <Field
                label="Password"
                secure
                placeholder={isSignup ? 'Create a password (8+ characters)' : 'Enter the password'}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
              />

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={16} color="#DC2626" />
                  <Text style={{ color: '#DC2626', fontSize: 13, flex: 1 }}>{error}</Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={busy || !phoneOk || password.length < (isSignup ? 8 : 1)}
                onPress={() => void run(async () => finish(isSignup ? await passwordSignup(fullPhone, password) : await passwordLogin(fullPhone, password)))}
                style={({ pressed }) => [
                  styles.cta,
                  (busy || !phoneOk || password.length < (isSignup ? 8 : 1)) && { opacity: 0.45 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.ctaText}>{busy ? 'Please wait…' : isSignup ? 'Sign Up' : 'Login'}</Text>
              </Pressable>

              {isSignup ? (
                <Text style={styles.legal}>
                  By signing up, you agree to our <Text style={{ color: ORANGE, fontWeight: '700' }}>Terms & Conditions</Text> and{' '}
                  <Text style={{ color: ORANGE, fontWeight: '700' }}>Privacy Policy</Text>. Your number is your driver ID — customer calls reach
                  you on it.
                </Text>
              ) : (
                <Text style={styles.legal}>Forgot your password? Call support — after verifying you, they reset it.</Text>
              )}
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              {step === 'phone' ? (
                <>
                  <Field
                    label="Phone Number"
                    prefix="+91"
                    placeholder="Enter the phone number"
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={setPhone}
                    maxLength={13}
                  />
                  <Text style={styles.legal}>We verify your number with an OTP.</Text>
                  {error ? <Text style={{ color: '#DC2626', fontSize: 13 }}>{error}</Text> : null}
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || !phoneOk}
                    onPress={() =>
                      void run(async () => {
                        const result = await startPhoneSignIn(fullPhone);
                        if (result.kind === 'dev') {
                          await finish(await exchangeForSession(result.idToken));
                          return;
                        }
                        setConfirmer(result);
                        setStep('otp');
                      })
                    }
                    style={({ pressed }) => [styles.cta, (busy || !phoneOk) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.ctaText}>{busy ? 'Please wait…' : 'Send OTP'}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Field label={`OTP sent to ${fullPhone}`} placeholder="6-digit code" keyboardType="number-pad" value={otp} onChangeText={setOtp} maxLength={6} autoFocus />
                  {error ? <Text style={{ color: '#DC2626', fontSize: 13 }}>{error}</Text> : null}
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || otp.length < 6}
                    onPress={() => void run(async () => finish(await exchangeForSession(await confirmer!.confirm(otp))))}
                    style={({ pressed }) => [styles.cta, (busy || otp.length < 6) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.ctaText}>{busy ? 'Please wait…' : 'Verify & continue'}</Text>
                  </Pressable>
                  <Button
                    title="Change number"
                    variant="ghost"
                    onPress={() => {
                      setStep('phone');
                      setOtp('');
                    }}
                  />
                </>
              )}
            </View>
          )}

          {/* Footer swap link — pinned to the bottom like the reference */}
          <View style={{ flex: 1 }} />
          {mode === 'phone_password' ? (
            <Text style={styles.footer}>
              {isSignup ? 'Already have an account? ' : "Don't have an account? "}
              <Text accessibilityRole="button" style={{ color: ORANGE, fontWeight: '800' }} onPress={() => switchPage(isSignup ? 'login' : 'signup')}>
                {isSignup ? 'Login' : 'Sign Up'}
              </Text>
            </Text>
          ) : (
            <Text style={styles.footer}>A ChefoTech product · operated by Relax Group</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 26, fontWeight: '900', color: INK, marginTop: 26 },
  sub: { fontSize: 13, color: MUTED, marginTop: 4 },
  hr: { height: 1, backgroundColor: '#EFEFF1', marginVertical: 20 },
  label: { fontSize: 12.5, fontWeight: '700', color: '#5c5c60' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 48,
  },
  fieldInput: { flex: 1, fontSize: 15, color: INK, paddingVertical: 0 },
  prefix: { fontSize: 15, fontWeight: '700', color: INK },
  vline: { width: 1, height: 20, backgroundColor: '#DDDDE0' },
  cta: { backgroundColor: ORANGE, borderRadius: 10, height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  legal: { fontSize: 12, color: MUTED, lineHeight: 17 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10 },
  footer: { textAlign: 'center', color: MUTED, fontSize: 13.5, paddingVertical: 22 },
});
