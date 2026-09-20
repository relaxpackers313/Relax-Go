import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { api, getToken, setLogoutHandler } from '@/lib/api';
import { Intro } from '@/components/intro';
import { colors } from '@/lib/theme';
import { Centered, Muted } from '@/components/ui';

export interface Me {
  id: string;
  phone: string;
  status: string;
  statusReason: string | null;
  fullName: string | null;
  vehicleType: string | null;
  registrationNumber: string | null;
  rating: { average: number | null; count: number };
  wallet: { balancePaise: number; freeCredits: number; promoCredits: number } | null;
  today: { calls: number; freeCallsRemaining: number; freeCallsPerDay: number };
}

function Gate({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    setLogoutHandler(() => router.replace('/login'));
  }, []);

  // Re-check the token on every navigation and decide the login-kick on the FRESH read —
  // stale state here bounced a freshly signed-in driver back to the login screen
  // (found by on-device testing).
  useEffect(() => {
    let active = true;
    void getToken().then((t) => {
      if (!active) return;
      setHasToken(!!t);
      if (!t && segments[0] !== 'login') router.replace('/login');
    });
    return () => {
      active = false;
    };
  }, [segments]);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/driver/me'),
    enabled: hasToken === true,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (hasToken !== true || !me.data) return;
    const top = segments[0] as string | undefined;
    // Approval gates everything operational (spec §10): route by status.
    if (me.data.status === 'approved') {
      if (top === 'login' || top === 'status' || top === 'onboarding') router.replace('/(tabs)');
    } else if (me.data.status === 'pending' && !me.data.fullName) {
      if (top !== 'onboarding') router.replace('/onboarding');
    } else if (top !== 'status' && top !== 'onboarding') {
      router.replace('/status');
    }
  }, [hasToken, me.data, segments]);

  if (hasToken === null || (hasToken && me.isPending)) {
    return (
      <Centered>
        <Muted>Starting Relax Go Driver…</Muted>
      </Centered>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } }));
  const [intro, setIntro] = useState(true);
  // The intro plays EXCLUSIVELY first — mounting screens underneath makes it stutter.
  if (intro) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <Intro tag="DRIVER" onDone={() => setIntro(false)} />
      </GestureHandlerRootView>
    );
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={client}>
        <StatusBar style="dark" />
        <Gate>
          <Stack
            screenOptions={{
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: '700' },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ title: 'Driver registration' }} />
            <Stack.Screen name="status" options={{ title: 'Registration status', headerBackVisible: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="lead/[id]" options={{ title: 'Customer request' }} />
            <Stack.Screen name="zone" options={{ title: 'Your zone' }} />
            <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          </Stack>
        </Gate>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
