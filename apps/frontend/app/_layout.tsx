/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from '@shopify/restyle';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import { useEffect } from 'react';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useFonts } from 'expo-font';
import Toast from 'react-native-toast-message';

import { toastConfig } from '../components/config/ToastConfig';
import '../core/i18n';
import { paperTheme, theme } from '../core/theme';

// IMPORTA AMBOS PROVIDERS
import { AuthProvider } from '../components/auth/AuthProvider';
import { AuthModalProvider } from '../core/auth/AuthModalProvider';

const queryClient = new QueryClient();

if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
  throw new Error('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env');
}
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'Montserrat-Regular': require('../assets/fonts/Montserrat-Regular.ttf'),
    'Montserrat-Medium': require('../assets/fonts/Montserrat-Medium.ttf'),
    'Montserrat-Bold': require('../assets/fonts/Montserrat-Bold.ttf'),
    'Montserrat-Italic': require('../assets/fonts/Montserrat-Italic.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider theme={theme}>
        <PaperProvider theme={paperTheme as any}>
          <QueryClientProvider client={queryClient}>
            {/* 1. AuthProvider: Maneja la sesión de Supabase */}
            <AuthProvider>
              {/* 2. AuthModalProvider: Maneja la UI del Bottom Sheet */}
              <AuthModalProvider>
                <Stack>
                  <Stack.Screen
                    name="(tabs)"
                    options={{ headerShown: false }}
                  />
                  <Stack.Screen
                    name="(auth)"
                    options={{ headerShown: false }}
                  />
                </Stack>
              </AuthModalProvider>
            </AuthProvider>

            <Toast config={toastConfig} />
          </QueryClientProvider>
        </PaperProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
