import { ThemeProvider } from '@shopify/restyle';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import { useEffect } from 'react';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import '../core/i18n';
import { paperTheme, theme } from '../core/theme';
import { useSession } from '../core/hooks/useSession';
import { useProtectedRoute } from '../core/hooks/useProtectedRoute';

const queryClient = new QueryClient();

// Configuración de Google Sign-In. Se ejecuta una sola vez.
if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
  throw new Error('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env');
}
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

// Este es el componente que realmente maneja la navegación
function RootLayoutNav() {
  const { session, loading } = useSession();

  // El hook se encarga de la lógica de redirección
  useProtectedRoute(session, loading);

  // Ocultamos la SplashScreen solo cuando la carga ha terminado
  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  // Mientras carga, no renderizamos el Stack para evitar parpadeos
  if (loading) {
    return null;
  }

  return (
    <Stack>
      {/* Ocultamos los headers aquí para que cada grupo los gestione */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
    </Stack>
  );
}

// Este es el componente principal que exportamos
export default function RootLayout() {
  return (
    <ThemeProvider theme={theme}>
      <PaperProvider theme={paperTheme}>
        <QueryClientProvider client={queryClient}>
          <RootLayoutNav />
        </QueryClientProvider>
      </PaperProvider>
    </ThemeProvider>
  );
}
