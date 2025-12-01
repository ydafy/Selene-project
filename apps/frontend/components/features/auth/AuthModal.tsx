/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useMemo, useState, forwardRef } from 'react';
// 1. AÑADIR IMPORTACIONES: Keyboard y TouchableWithoutFeedback
import { StyleSheet, Keyboard, TouchableWithoutFeedback } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { AppImage } from '../../ui/AppImage';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoPath = require('../../../assets/images/SeleneLunaLogo.png');

export type AuthModalRef = BottomSheetModal;

type AuthView = 'login' | 'register';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const AuthModal = forwardRef<BottomSheetModal, {}>((props, ref) => {
  const theme = useTheme<Theme>();
  const router = useRouter();

  const [currentView, setCurrentView] = useState<AuthView>('login');

  const snapPoints = useMemo(() => ['85%'], []);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        // Hacemos que al tocar el fondo oscuro también se cierre el teclado Y el modal
        onPress={() => {
          Keyboard.dismiss();
          (ref as any).current?.dismiss();
        }}
      />
    ),
    [],
  );

  const handleSuccess = (email?: string) => {
    (ref as any).current?.dismiss();
    Keyboard.dismiss();

    if (email) {
      router.push({ pathname: '/(auth)/verify-code', params: { email } });
    }
  };

  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
      handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      {/*
          2. ENVOLVER EL CONTENIDO:
          Usamos TouchableWithoutFeedback para detectar toques en el área vacía del modal.
          Importante: Esto debe estar DENTRO del BottomSheetView para no romper el gesto de arrastre.
      */}
      <BottomSheetView style={styles.contentContainer}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          {/* Necesitamos un View/Box que ocupe todo el espacio para recibir el toque */}
          <Box paddingHorizontal="xl" paddingBottom="xl" flex={1}>
            <Box alignItems="center" marginBottom="l" marginTop="s">
              <AppImage
                source={logoPath}
                style={{ width: 180, height: 60 }}
                contentFit="contain"
              />
              <Text variant="body-md" color="textSecondary" marginTop="s">
                {currentView === 'login'
                  ? 'Bienvenido de vuelta'
                  : 'Crea tu cuenta en segundos'}
              </Text>
            </Box>

            {currentView === 'login' ? (
              <LoginForm
                onSuccess={() => handleSuccess()}
                onRegisterPress={() => setCurrentView('register')}
                onForgotPasswordPress={() => {
                  (ref as any).current?.dismiss();
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
});

const styles = StyleSheet.create({
  contentContainer: {
    flex: 1,
  },
});
