import React, { useEffect, useRef } from 'react';
import { Alert, BackHandler } from 'react-native';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import Animated, { withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Box, Text } from '../../shared/ui/base';
import { PrimaryButton } from '../../shared/ui/primary-button';
import { GlobalHeader } from '../../shared/ui/global-header';

import { ErrorState } from '../../shared/ui/error-state';
import { Theme } from '../../shared/theme';
import { usePaymentProcess } from '../../features/checkout/hooks/use-payment-process';
import { formatCurrency } from '../../shared/utils/format';
import { OrderPreviewStrip } from '../../features/checkout/components/order-preview-strip';
import { ProductSummaryModal } from '../../features/checkout/components/product-summary-modal';
import { Stack } from 'expo-router';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useCartStore } from '@/shared/store/use-cart-store';
import {
  useSellerPaymentReadiness,
  isSellerBlocked,
} from '../../features/payments/hooks/use-seller-payment-readiness';

// Mount entrance: scale 0.8 -> 1 with a fade, driven by a spring.
const iconEntering = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.8 }] },
    animations: {
      opacity: withSpring(1, { damping: 15 }),
      transform: [{ scale: withSpring(1, { damping: 15 }) }],
    },
  };
};

export default function PaymentScreen() {
  const { t } = useTranslation('checkout');
  const theme = useTheme<Theme>();

  const summaryModalRef = useRef<BottomSheetModal>(null);
  const items = useCartStore((state) => state.items);

  const { data: readiness } = useSellerPaymentReadiness(
    items.map((item) => item.id),
  );
  const sellerNotReady = items.some((item) =>
    isSellerBlocked(readiness, item.id),
  );

  const {
    loading,
    isReady,
    isConfirming,
    error,
    paymentData,
    handlePayment,
    retry,
  } = usePaymentProcess();

  const isBusy = loading || isConfirming;

  const onPayPress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await handlePayment();

    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (!result.cancelled) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('payment.failedTitle'), result.message);
    }
  };

  useEffect(() => {
    const onBackPress = () => isBusy; // Si isBusy es true, Android ignora el botón físico de atrás
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [isBusy]);

  if (sellerNotReady) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader title={t('payment.securityTitle')} showBack />
        <ErrorState
          title={t('payment.errorTitle')}
          message={t('payment.sellerNotReadyError')}
        />
      </Box>
    );
  }

  if (error) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen
          options={{ headerShown: false, gestureEnabled: !isBusy }}
        />
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
      <Stack.Screen options={{ headerShown: false, gestureEnabled: !isBusy }} />
      <GlobalHeader title={t('payment.securityTitle')} showBack={!isBusy} />

      <Box flex={1} justifyContent="center" alignItems="center" padding="l">
        {/* TARJETA DE ESTADO */}
        <Box
          backgroundColor="cardBackground"
          padding="xl"
          borderRadius="xl"
          alignItems="center"
          width="100%"
          style={{
            shadowColor: theme.colors.shadow,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.1,
            shadowRadius: 12,
            elevation: 5,
          }}
        >
          {/* ICONO ANIMADO */}
          <Animated.View entering={iconEntering}>
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
          </Animated.View>

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
                  : `${t('payment.confirmBtn')} ${formatCurrency((paymentData?.amount || 0) / 100)}`}
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
