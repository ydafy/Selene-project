/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * @file app/_layout.tsx
 * @description Punto de entrada principal de la App.
 * Configura proveedores globales, inicializa servicios, maneja la Splash Animada y gestiona el estado del sistema.
 */

import 'react-native-get-random-values';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from '@shopify/restyle';
import { PaperProvider } from 'react-native-paper';
import { QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useFonts } from 'expo-font';
import Toast from 'react-native-toast-message';
import { StripeProvider } from '@stripe/stripe-react-native';
import { ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Platform, AppState, Animated, StyleSheet } from 'react-native';
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

import { OfflineNotice } from '../components/ui/OfflineNotice';

import { queryClient } from '../core/db/queryClient';

import { SystemGuard } from '../components/auth/SystemGuard';

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
if (GOOGLE_ID) {
  GoogleSignin.configure({ webClientId: GOOGLE_ID });
}

const STRIPE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

// --- COMPONENTE SPLASH SCREEN ANIMADA (Transición fluida sin parpadeos) ---
function AnimatedSplashOverlay({
  isReady,
  onAnimationComplete,
}: {
  isReady: boolean;
  onAnimationComplete: () => void;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isReady) {
      // 1. Ocultamos la splash nativa estática del OS
      SplashScreen.hideAsync();

      // 2. Disparamos la animación suave de salida del logo
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1.08,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(() => {
        onAnimationComplete();
      });
    }
  }, [isReady]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        styles.splashContainer,
        { opacity, transform: [{ scale }] },
      ]}
      pointerEvents="none"
    >
      <Animated.Image
        source={require('../assets/images/splash-icon.png')}
        style={styles.splashLogo}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

// --- 3. COMPONENTE PRINCIPAL ---
export default function RootLayout() {
  const [splashFinished, setSplashFinished] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    'Montserrat-Regular': require('../assets/fonts/Montserrat-Regular.ttf'),
    'Montserrat-Medium': require('../assets/fonts/Montserrat-Medium.ttf'),
    'Montserrat-Bold': require('../assets/fonts/Montserrat-Bold.ttf'),
    'Montserrat-Italic': require('../assets/fonts/Montserrat-Italic.ttf'),
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (Platform.OS !== 'web') {
        focusManager.setFocused(status === 'active');
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const isAppReady = fontsLoaded || !!fontError;

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
                        merchantIdentifier="merchant.com.selene.marketplace"
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

      {/* OVERLAY DE ANIMACIÓN: Se desmonta al completar para liberar memoria */}
      {!splashFinished && (
        <AnimatedSplashOverlay
          isReady={isAppReady}
          onAnimationComplete={() => setSplashFinished(true)}
        />
      )}
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

const styles = StyleSheet.create({
  splashContainer: {
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99999,
  },
  splashLogo: {
    width: 180,
    height: 180,
  },
});
