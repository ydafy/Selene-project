/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
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
import { AuthProvider } from '../components/auth/AuthProvider';

const queryClient = new QueryClient();

// Configuración de Google Sign-In.
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

  // Este useEffect ahora solo se preocupa de la SplashScreen.
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // No renderizamos nada hasta que las fuentes estén listas.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider theme={theme}>
      <PaperProvider theme={paperTheme as any}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Stack>
              {/* Por defecto, Expo Router renderizará el grupo (tabs)
                porque es el primero en la lista y contiene un archivo 'index.tsx'. */}
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="(auth)"
                options={{
                  headerShown: false,
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                }}
              />
            </Stack>
          </AuthProvider>
          <Toast config={toastConfig} />
        </QueryClientProvider>
      </PaperProvider>
    </ThemeProvider>
  );
}
