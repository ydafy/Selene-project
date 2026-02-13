import React, { useRef } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics'; // Ya lo tenías, perfecto.

import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GlobalHeader } from '../../components/layout/GlobalHeader';

import { ErrorState } from '../../components/ui/ErrorState';
import { Theme } from '../../core/theme';
import { usePaymentProcess } from '../../core/hooks/usePaymentProcess';
import { formatCurrency } from '../../core/utils/format';
import { OrderPreviewStrip } from '../../components/features/checkout/OrderPreviewStrip';
import { ProductSummaryModal } from '../../components/features/checkout/ProductSummaryModal';
import { Stack } from 'expo-router';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useCartStore } from '@/core/store/useCartStore';

export default function PaymentScreen() {
  const { t } = useTranslation('checkout');
  const theme = useTheme<Theme>();

  const summaryModalRef = useRef<BottomSheetModal>(null);
  const items = useCartStore((state) => state.items);

  const {
    loading,
    isReady,
    isConfirming,
    error,
    paymentData,
    handlePayment,
    retry,
  } = usePaymentProcess();

  // LÓGICA DE HAPTICS AQUI
  const onPayPress = async () => {
    // 1. Feedback físico al presionar el botón
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await handlePayment();

    if (result.success) {
      // 2. Feedback de Éxito (Vibración positiva) antes de navegar
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // La navegación a /success ocurre dentro del hook
    } else if (!result.cancelled) {
      // 3. Feedback de Error (Vibración de advertencia)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('payment.failedTitle'), result.message);
    }
  };

  const isBusy = loading || isConfirming;

  if (error) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader title={t('payment.securityTitle')} showBack />
        <ErrorState
          title={t('payment.errorTitle')}
          message={error}
          onRetry={retry}
        />
      </Box>
    );
  }

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader title={t('payment.securityTitle')} showBack={!loading} />

      <Box flex={1} justifyContent="center" alignItems="center" padding="l">
        {/* TARJETA DE ESTADO */}
        <Box
          backgroundColor="cardBackground"
          padding="xl"
          borderRadius="xl"
          alignItems="center"
          width="100%"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.1,
            shadowRadius: 12,
            elevation: 5,
          }}
        >
          {/* ICONO ANIMADO */}
          <MotiView
            from={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', damping: 15 }}
          >
            <Box
              width={100}
              height={100}
              borderRadius="xl"
              backgroundColor={isReady ? 'success' : 'background'}
              justifyContent="center"
              alignItems="center"
              marginBottom="m"
              borderWidth={isReady ? 0 : 1}
              borderColor="separator"
            >
              <MaterialCommunityIcons
                name={isReady ? 'shield-check' : 'shield-sync'}
                size={50}
                color={isReady ? 'white' : theme.colors.primary}
              />
            </Box>
          </MotiView>

          <Text variant="header-xl" textAlign="center" marginBottom="s">
            {isReady ? t('payment.reservedTitle') : t('payment.reservingTitle')}
          </Text>

          <Text
            variant="body-md"
            color="textSecondary"
            textAlign="center"
            marginBottom="xl"
          >
            {isReady ? t('payment.reservedDesc') : t('payment.reservingDesc')}
          </Text>

          {!loading && isReady && (
            <Box marginBottom="l" width="100%">
              <OrderPreviewStrip
                items={items}
                onPress={() => summaryModalRef.current?.present()}
              />
            </Box>
          )}

          {/* BOTÓN DE ACCIÓN */}
          <Box width="100%" marginTop="m">
            <PrimaryButton
              onPress={onPayPress}
              icon={isBusy ? undefined : 'lock'}
              loading={isBusy}
              disabled={isBusy || !isReady}
            >
              {isConfirming
                ? 'Confirmando pago...'
                : loading
                  ? t('payment.processing')
                  : `${t('payment.confirmBtn')} ${formatCurrency(paymentData?.amount || 0)}`}
            </PrimaryButton>
          </Box>
        </Box>

        {/* FOOTER DE CONFIANZA (Corregido: Eliminado Box duplicado) */}
        <Box
          flexDirection="row"
          alignItems="center"
          marginTop="xl"
          opacity={0.6}
        >
          <MaterialCommunityIcons
            name="lock"
            size={14}
            color={theme.colors.textSecondary}
          />
          <Text variant="caption-md" color="textSecondary" marginLeft="xs">
            {t('payment.securePayText')}
          </Text>
        </Box>
      </Box>
      <ProductSummaryModal innerRef={summaryModalRef} items={items} />
    </Box>
  );
}
