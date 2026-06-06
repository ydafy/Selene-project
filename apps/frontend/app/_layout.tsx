/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * @file app/_layout.tsx
 * @description Punto de entrada principal de la App.
 * Configura proveedores globales, inicializa servicios y gestiona el estado del sistema.
 */

import 'react-native-get-random-values';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from '@shopify/restyle';
import { PaperProvider } from 'react-native-paper';
import { QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useFonts } from 'expo-font';
import Toast from 'react-native-toast-message';
import { StripeProvider } from '@stripe/stripe-react-native';
import { ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Platform, AppState } from 'react-native';
import Constants from 'expo-constants';
import { onlineManager, focusManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

// Configuración y Temas
import { toastConfig } from '../components/config/ToastConfig';
import '../core/i18n';
import { paperTheme, theme, navigationTheme } from '../core/theme';

// Proveedores y Hooks
import { AuthProvider } from '../components/auth/AuthProvider';
import { AuthModalProvider } from '../core/auth/AuthModalProvider';
import { NotificationWatcher } from '../components/features/notifications/NotificationWatcher';
import { useSystemConfig } from '../core/hooks/useSystemConfig';
import { isVersionLower } from '../core/utils/version';
import { MaintenanceScreen } from '../components/ui/MaintenanceScreen';
import { Box, Text } from '../components/base';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { OfflineNotice } from '../components/ui/OfflineNotice';
import { ErrorState } from '@/components/ui/ErrorState';
import { queryClient } from '../core/db/queryClient';

// --- 1. BOOTSTRAP (Configuración Global Permanente - FUERA DEL COMPONENTE) ---
SplashScreen.preventAutoHideAsync();

// A. Configuración de Red: Se hace una sola vez al cargar el archivo
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
});

// C. Configuración de Google
const GOOGLE_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
if (!GOOGLE_ID) {
  throw new Error('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env');
}
GoogleSignin.configure({ webClientId: GOOGLE_ID });

const STRIPE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

//  COMPONENTE GUARDIA (Lógica de Mantenimiento y Versión) ---
function SystemGuard({ children }: { children: React.ReactNode }) {
  const { data: config, isLoading, isError, refetch } = useSystemConfig();
  const currentVersion = Constants.expoConfig?.version || '1.0.0';

  if (isLoading && !config) return null;

  if (isError && !config) {
    return <ErrorState onRetry={refetch} />;
  }

  if (config?.is_maintenance) {
    return <MaintenanceScreen />;
  }

  const minVersion =
    Platform.OS === 'ios'
      ? config?.min_version_ios
      : config?.min_version_android;
  if (minVersion && isVersionLower(currentVersion, minVersion)) {
    return (
      <Box
        flex={1}
        backgroundColor="background"
        justifyContent="center"
        alignItems="center"
        padding="xl"
      >
        <Text variant="header-xl" color="primary">
          ACTUALIZACIÓN REQUERIDA
        </Text>
        <Text variant="body-md" textAlign="center" marginTop="m">
          La versión {currentVersion} ha sido deprecada. Por favor instala la
          {minVersion}.
        </Text>
        <PrimaryButton
          style={{ marginTop: 24 }}
          onPress={() => {
            /* Link a Store */
          }}
        >
          ACTUALIZAR AHORA
        </PrimaryButton>
      </Box>
    );
  }

  return <>{children}</>;
}

// --- 3. COMPONENTE PRINCIPAL ---
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'Montserrat-Regular': require('../assets/fonts/Montserrat-Regular.ttf'),
    'Montserrat-Medium': require('../assets/fonts/Montserrat-Medium.ttf'),
    'Montserrat-Bold': require('../assets/fonts/Montserrat-Bold.ttf'),
    'Montserrat-Italic': require('../assets/fonts/Montserrat-Italic.ttf'),
  });

  useEffect(() => {
    // A. CONFIGURACIÓN DE FOCO (AppState)
    // Se registra al montar y se limpia al desmontar
    const subscription = AppState.addEventListener('change', (status) => {
      if (Platform.OS !== 'web') {
        focusManager.setFocused(status === 'active');
      }
    });

    // B. CONTROL DE SPLASH SCREEN
    // Ocultamos el splash solo cuando las fuentes están listas
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }

    // --- CLEANUP ---
    return () => {
      subscription.remove();
    };
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider theme={theme}>
        <PaperProvider theme={paperTheme}>
          <QueryClientProvider client={queryClient}>
            <NavThemeProvider value={navigationTheme}>
              <AuthProvider>
                <AuthModalProvider>
                  <OfflineNotice />
                  <SystemGuard>
                    {STRIPE_KEY ? (
                      <StripeProvider
                        publishableKey={STRIPE_KEY}
                        merchantIdentifier="merchant.com.selene.app"
                      >
                        <RootStack />
                      </StripeProvider>
                    ) : (
                      <RootStack />
                    )}
                  </SystemGuard>
                </AuthModalProvider>
                <NotificationWatcher />
              </AuthProvider>
            </NavThemeProvider>
            <Toast config={toastConfig} />
          </QueryClientProvider>
        </PaperProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen
        name="sell"
        options={{
          headerShown: false,
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="profile/edit"
        options={{
          headerShown: false,
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="profile/support"
        options={{
          headerShown: false,
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
