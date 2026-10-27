import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { FocusProvider, useFocus } from '@/store/FocusContext';
import { PlansProvider } from '@/store/PlansContext';
import { FontAvailability } from '@/components/AppText';
import { StartupScreen } from '@/components/StartupScreen';
import { useStartupFonts } from '@/hooks/useStartupFonts';
import { useColors } from '@/hooks/useColors';
import { hideSplashSafely, holdSplashSafely } from '@/services/startup';

// Hand the native splash to a laid-out React loading screen, not a blank frame.
// Navigation still waits for fonts, an error, or the bounded font fallback.
void holdSplashSafely(SplashScreen);

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="task"
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
    </Stack>
  );
}

function StartupContent({ fontsPending }: { fontsPending: boolean }) {
  const { isReady, storageError, retryLoad } = useFocus();
  if (!isReady || fontsPending) {
    return (
      <StartupScreen
        message={fontsPending ? 'Preparing your display…' : 'Loading your saved tasks and history…'}
        error={!isReady ? storageError : null}
        onRetry={retryLoad}
      />
    );
  }
  return <RootLayoutNav />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const { pending: fontsPending, timedOut } = useStartupFonts(fontsLoaded, fontError);
  const colors = useColors();
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [splashError, setSplashError] = useState<string | null>(null);
  const splashRequested = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const dismissSplash = useCallback(async () => {
    const hidden = await hideSplashSafely(SplashScreen);
    if (mounted.current) setSplashError(hidden ? null : 'The startup screen could not close. Try again, or reopen Focus Garden in Expo Go.');
  }, []);

  useEffect(() => {
    if (!firstFrameReady || splashRequested.current) return;
    splashRequested.current = true;
    void dismissSplash();
  }, [firstFrameReady, fontsLoaded, fontError, timedOut, dismissSplash]);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <FontAvailability.Provider value={fontsLoaded}>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <FocusProvider>
                <PlansProvider>
                <KeyboardProvider>
                  <View style={{ flex: 1 }} onLayout={() => setFirstFrameReady(true)}>
                    {splashError ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry closing the startup screen"
                        onPress={() => { void dismissSplash(); }}
                        style={{ backgroundColor: colors.accent, padding: 16 }}
                      >
                        <Text style={{ color: colors.foreground }}>{splashError}</Text>
                      </Pressable>
                    ) : null}
                    <StartupContent fontsPending={fontsPending} />
                  </View>
                </KeyboardProvider>
                </PlansProvider>
              </FocusProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </FontAvailability.Provider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
