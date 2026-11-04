/**
 * @file app/error.tsx
 * Versión 1.1: Auditada. Incluye trazabilidad real y i18n.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundaryProps } from 'expo-router';
import Animated, { withSpring } from 'react-native-reanimated';
import { Box, Text } from '../shared/ui/base';
import { PrimaryButton } from '../shared/ui/primary-button';
import { getSharedStyles } from '../shared/theme/shared-styles';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../shared/theme';
import { supabase } from '../shared/lib/supabase';

// Mount entrance: scale 0.9 -> 1 with a fade, driven by a spring.
const contentEntering = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: {
      opacity: withSpring(1),
      transform: [{ scale: withSpring(1) }],
    },
  };
};

export default function GlobalErrorBoundary({
  error,
  retry,
}: ErrorBoundaryProps) {
  const { t } = useTranslation('common');
  const theme = useTheme<Theme>();
  const styles = getSharedStyles(theme);
  const [reportId, setReportId] = useState<string | null>(null);

  useEffect(() => {
    const logError = async () => {
      try {
        const { data, error: insertError } = await supabase
          .from('system_logs')
          .insert({
            message: error?.message ?? 'Unknown error',
            stack_trace: error?.stack ?? null,
            level: 'ERROR',
          })
          .select();

        if (insertError) {
          if (__DEV__) console.error('Supabase insert error:', insertError);
        } else {
          if (data?.[0]) setReportId(data[0].id.slice(0, 8).toUpperCase());
        }
      } catch (e) {
        if (__DEV__) console.error('logError fatal:', e);
      }
    };

    logError();
  }, [error]);

  return (
    <Box
      flex={1}
      backgroundColor="background"
      justifyContent="center"
      alignItems="center"
      padding="xl"
    >
      <Animated.View
        entering={contentEntering}
        style={{ alignItems: 'center', width: '100%' }}
      >
        <Box
          width={70}
          height={70}
          borderRadius="m"
          borderWidth={1}
          borderColor="error"
          justifyContent="center"
          alignItems="center"
          marginBottom="l"
        >
          <Text color="error" variant="header-xl">
            !
          </Text>
        </Box>

        <Text
          style={[
            styles.monoText,
            { color: theme.colors.error, marginBottom: 8 },
          ]}
        >
          [ {t('globalError.systemAnomaly')} ]
        </Text>

        <Text variant="header-xl" textAlign="center" color="textPrimary">
          {t('globalError.title')}
        </Text>

        <Text
          variant="body-md"
          textAlign="center"
          color="textSecondary"
          marginTop="m"
          style={{ lineHeight: 24 }}
        >
          {t('globalError.message')}
        </Text>

        <PrimaryButton
          onPress={retry}
          style={{
            marginTop: 32,
            width: '100%',
            backgroundColor: theme.colors.error,
          }}
          labelStyle={{ color: 'white' }}
          icon="refresh"
        >
          {t('globalError.retryButton')}
        </PrimaryButton>

        {reportId && (
          <Box marginTop="xl" opacity={0.3}>
            <Text style={[styles.monoText, { fontSize: 7 }]}>
              REPORT_ID: {reportId}
            </Text>
          </Box>
        )}
      </Animated.View>
    </Box>
  );
}
