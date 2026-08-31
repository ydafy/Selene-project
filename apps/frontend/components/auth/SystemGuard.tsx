/**
 * @file components/guards/SystemGuard.tsx
 * @description Guardia de seguridad del sistema (Baneo permanente, Modo Mantenimiento y Versión Mínima).
 */

import React from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../base';
import { PrimaryButton } from '../ui/PrimaryButton';
import { ErrorState } from '../ui/ErrorState';
import { MaintenanceScreen } from '../ui/MaintenanceScreen';

import { useSystemConfig } from '../../core/hooks/useSystemConfig';
import { useAuthContext } from '../auth/AuthProvider';
import { isVersionLower } from '../../core/utils/version';
import { supabase } from '../../core/db/supabase';

export function SystemGuard({ children }: { children: React.ReactNode }) {
  const { data: config, isLoading, isError, refetch } = useSystemConfig();
  const { isBanned, statusReason } = useAuthContext();
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
            color="theme.colors.error"
          />
        </Box>

        <Text
          variant="header-xl"
          color="error"
          textAlign="center"
          marginBottom="s"
        >
          CUENTA SUSPENDIDA
        </Text>

        <Text
          variant="body-md"
          color="textSecondary"
          textAlign="center"
          marginBottom="xl"
        >
          {statusReason ||
            'Tu cuenta ha sido dada de baja permanentemente por infringir las normas de seguridad de Selene.'}
        </Text>

        <PrimaryButton onPress={() => supabase.auth.signOut()}>
          CERRAR SESIÓN
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
