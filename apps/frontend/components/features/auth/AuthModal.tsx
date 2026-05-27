/**
 * @file components/features/auth/AuthModal.tsx
 * @description Modal de autenticación global.
 * Orquestra el intercambio entre Login y Registro con soporte para vista inicial dinámica.
 */

import React, {
  useCallback,
  useMemo,
  useState,
  forwardRef,
  useEffect,
  useRef,
} from 'react';
import { StyleSheet, Keyboard, TouchableWithoutFeedback } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { AppImage } from '../../ui/AppImage';

const logoPath = require('../../../assets/images/SeleneLunaLogo.png');

type AuthView = 'login' | 'register';

interface AuthModalProps {
  initialView?: AuthView;
}

export const AuthModal = forwardRef<BottomSheetModal, AuthModalProps>(
  ({ initialView = 'login' }, ref) => {
    const theme = useTheme<Theme>();
    const router = useRouter();
    const { t } = useTranslation('auth');
    const snapPoints = useMemo(() => ['85%'], []);

    const [currentView, setCurrentView] = useState<AuthView>(initialView);

    const pendingNavigation = useRef<{ path: string; params?: any } | null>(
      null,
    );

    // --- 1. SINCRONIZACIÓN CON EL PROVIDER ---
    useEffect(() => {
      if (initialView) {
        setCurrentView(initialView);
      }
    }, [initialView]);

    const dismissModal = useCallback(() => {
      if (ref && 'current' in ref) ref.current?.dismiss();
    }, [ref]);

    /**
     * Callback oficial de la librería.
     * Se dispara cuando el modal ha terminado su animación de salida.
     */
    const handleDismiss = useCallback(() => {
      if (pendingNavigation.current) {
        const { path, params } = pendingNavigation.current;
        router.push({ pathname: path as any, params });
        pendingNavigation.current = null;
      }
    }, [router]);

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.7}
          onPress={() => {
            Keyboard.dismiss();
            dismissModal();
          }}
        />
      ),
      [dismissModal],
    );

    const handleSuccess = (email?: string) => {
      Keyboard.dismiss();

      if (email) {
        pendingNavigation.current = {
          path: '/(auth)/verify-code',
          params: { email },
        };
      }

      // C. Iniciamos el cierre del modal. handleDismiss hará el resto.
      dismissModal();
    };

    return (
      <BottomSheetModal
        ref={ref}
        index={0}
        snapPoints={snapPoints}
        onDismiss={handleDismiss}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustPan"
      >
        <BottomSheetView style={styles.contentContainer}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <Box paddingHorizontal="xl" paddingBottom="xl" flex={1}>
              <Box alignItems="center" marginBottom="l" marginTop="s">
                <AppImage
                  source={logoPath}
                  style={{ width: 180, height: 60 }}
                  contentFit="contain"
                />
                <Text variant="body-md" color="textSecondary" marginTop="s">
                  {currentView === 'login'
                    ? t('modal.welcomeBack', 'Bienvenido de vuelta')
                    : t('modal.createAccount', 'Crea tu cuenta en segundos')}
                </Text>
              </Box>

              {currentView === 'login' ? (
                <LoginForm
                  onSuccess={() => handleSuccess()}
                  onRegisterPress={() => setCurrentView('register')}
                  onForgotPasswordPress={() => {
                    dismissModal();
                    router.push('/(auth)/forgotPassword');
                  }}
                />
              ) : (
                <RegisterForm
                  onSuccess={(email) => handleSuccess(email)}
                  onLoginPress={() => setCurrentView('login')}
                />
              )}
            </Box>
          </TouchableWithoutFeedback>
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create({
  contentContainer: { flex: 1 },
});
