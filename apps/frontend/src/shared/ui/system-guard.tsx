/**
 * @file apps/frontend/src/shared/ui/system-guard.tsx
 * @description Guardia de seguridad del sistema (Baneo permanente, Modo Mantenimiento y Versión Mínima).
 */

import React from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';

import { Box, Text } from './base';
import { PrimaryButton } from './primary-button';
import { signOutUser } from '../../core/auth/signOut';
import { ErrorState } from './error-state';
import { MaintenanceScreen } from './maintenance-screen';

import { useSystemConfig } from '../hooks/use-system-config';
import { useAuthContext } from '../lib/auth/auth-provider';
import { isVersionLower } from '../utils/version';
import { Theme } from '../theme';

export function SystemGuard({ children }: { children: React.ReactNode }) {
  const { data: config, isLoading, isError, refetch } = useSystemConfig();
  const { isBanned, statusReason } = useAuthContext();
  const { t } = useTranslation('auth');
  const theme = useTheme<Theme>();
  const currentVersion = Constants.expoConfig?.version || '1.0.0';

  if (isLoading && !config) return null;

  if (isError && !config) {
    return <ErrorState onRetry={refetch} />;
  }

  // 1. GUARDIA DE SEGURIDAD: USUARIO BANEADO (Cárcel Declarativa)
  if (isBanned) {
    return (
      <Box
        flex={1}
        backgroundColor="background"
        justifyContent="center"
        alignItems="center"
        padding="xl"
      >
        <Box
          width={80}
          height={80}
          borderRadius="full"
          backgroundColor="cardBackground"
          justifyContent="center"
          alignItems="center"
          marginBottom="l"
          borderWidth={1}
          borderColor="error"
        >
          <MaterialCommunityIcons
            name="account-cancel"
            size={40}
            color={theme.colors.error}
          />
        </Box>

        <Text
          variant="header-xl"
          color="error"
          textAlign="center"
          marginBottom="s"
        >
          {t('auth:bannedAccount.title')}
        </Text>

        <Text
          variant="body-md"
          color="textSecondary"
          textAlign="center"
          marginBottom="xl"
        >
          {statusReason || t('auth:bannedAccount.defaultMessage')}
        </Text>

        <PrimaryButton onPress={() => signOutUser()}>
          {t('auth:bannedAccount.signOut')}
        </PrimaryButton>
      </Box>
    );
  }

  // 2. MODO MANTENIMIENTO
  if (config?.is_maintenance) {
    return <MaintenanceScreen />;
  }

  // 3. ACTUALIZACIÓN OBLIGATORIA DE VERSIÓN
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
        <Text
          variant="body-md"
          textAlign="center"
          marginTop="m"
          color="textSecondary"
        >
          La versión {currentVersion} ha sido deprecada. Por favor instala la{' '}
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
