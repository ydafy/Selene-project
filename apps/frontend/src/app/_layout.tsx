/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * @file app/_layout.tsx
 * @description Punto de entrada principal de la App.
 * Configura proveedores globales, inicializa servicios, maneja la Splash Animada y gestiona el estado del sistema.
 */

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
import { ThemeProvider as NavThemeProvider } from 'expo-router/react-navigation';
import { Platform, AppState, Animated, StyleSheet } from 'react-native';
import { onlineManager, focusManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

// Configuración y Temas
import { toastConfig } from '@/shared/ui/feedback/toast-config';
import '@/shared/i18n';
import { paperTheme, theme, navigationTheme } from '@/shared/theme';

// Proveedores y Hooks
import { AuthProvider } from '@/shared/lib/auth/auth-provider';
import type { SignOutWiring } from '@/shared/lib/auth/create-sign-out';
import { resetUserQueries } from '@/shared/lib/auth/user-queries.logic';
import { AuthModalProvider } from '@/features/auth/components/auth-modal-provider';
import { CaptchaProvider } from '@/features/auth/components/captcha-provider';
import { NotificationWatcher } from '@/features/notifications/components/notification-watcher';

import { PushRegistration } from '@/features/notifications/components/push-registration';
import { PushPermissionPrompt } from '@/features/notifications/components/push-permission-prompt';
import { PushTapHandler } from '@/features/notifications/components/push-tap-handler';
import { OfflineNotice } from '@/shared/ui/feedback/offline-notice';

import { queryClient } from '@/shared/lib/query-client';
import { useCheckoutStore } from '@/shared/store/use-checkout-store';
import { useCartStore } from '@/shared/store/use-cart-store';
import { useDisputeStore } from '@/features/orders/store/use-dispute-store';
import { useSearchStore } from '@/features/search/store/use-search-store';
import { useProductHistoryStore } from '@/shared/store/use-product-history-store';
import { useSellStore } from '@/features/sell/store/use-sell-store';
import { useReviewStore } from '@/features/orders/store/use-review-store';
import { pushRegistrar } from '@/features/notifications/lib/push-registration';

import { SystemGuard } from '@/shared/ui/feedback/system-guard';

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

// D. Sign-out: everything tied to the signed-in user. This is the only layer that may import
// every feature, so the list lives here and `AuthProvider` receives it. A store that persists
// to AsyncStorage also clears its key, so no previous user's data stays on the device
// (`sign-out-resets.guard.test.ts` fails when one is missing). Device preferences such as
// `useExperienceStore` are deliberately kept.
const SIGN_OUT_WIRING: SignOutWiring = {
  userDataResets: [
    () => resetUserQueries(queryClient),
    () => useCheckoutStore.getState().resetCheckout(),
    () => {
      useCartStore.getState().clearCart();
      useCartStore.persist.clearStorage();
    },
    () => {
      useDisputeStore.getState().reset();
      useDisputeStore.persist.clearStorage();
    },
    () => {
      useSearchStore.getState().clearHistory();
      useSearchStore.persist.clearStorage();
    },
    () => {
      useProductHistoryStore.getState().clearHistory();
      useProductHistoryStore.persist.clearStorage();
    },
    () => useSellStore.getState().resetDraft(),
    () => useReviewStore.getState().resetIgnored(),
  ],
  unregisterPush: pushRegistrar.unregister,
  signOutFinished: pushRegistrar.signOutFinished,
};

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
        StyleSheet.absoluteFill,
        styles.splashContainer,
        { opacity, transform: [{ scale }] },
      ]}
      pointerEvents="none"
    >
      <Animated.Image
        source={require('@/assets/images/splash-icon.png')}
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
    'Montserrat-Regular': require('@/assets/fonts/Montserrat-Regular.ttf'),
    'Montserrat-Medium': require('@/assets/fonts/Montserrat-Medium.ttf'),
    'Montserrat-Bold': require('@/assets/fonts/Montserrat-Bold.ttf'),
    'Montserrat-Italic': require('@/assets/fonts/Montserrat-Italic.ttf'),
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
              <AuthProvider signOutWiring={SIGN_OUT_WIRING}>
                <CaptchaProvider>
                  <AuthModalProvider>
                    <OfflineNotice />
                    <SystemGuard>
                      <PushTapHandler />
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
                </CaptchaProvider>
                <NotificationWatcher />
                <PushRegistration />
                <PushPermissionPrompt />
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
        name="checkout"
        options={{
          headerShown: false,
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="sell"
        options={{
          headerShown: false,
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen name="profile" options={{ headerShown: false }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99999,
  },
  splashLogo: {
    width: 180,
    height: 180,
  },
});
