import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Intro } from '@/components/intro';
import { warmUpLocation } from '@/lib/location-cache';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } }));
  const [intro, setIntro] = useState(true);
  // The intro plays EXCLUSIVELY first — mounting the map home underneath it at the same
  // time saturates the UI thread and makes the animation stutter. GPS warms up meanwhile.
  if (intro) {
    warmUpLocation();
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <Intro onDone={() => setIntro(false)} />
      </GestureHandlerRootView>
    );
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={client}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="request/[driverId]" options={{ title: 'Request driver', presentation: 'modal' }} />
          <Stack.Screen name="lead/[id]" options={{ title: 'Your request' }} />
          <Stack.Screen name="destination" options={{ title: 'Where are you going?', presentation: 'modal' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="activity" options={{ title: 'Activity' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings & safety' }} />
          <Stack.Screen name="support" options={{ title: 'Support' }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
