import React, { useEffect } from 'react';
import { BackHandler, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import Animated, { withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Box, Text } from '../../shared/ui/base';
import { PrimaryButton } from '../../shared/ui/primary-button';
import { Theme } from '../../shared/theme';
import { useCheckoutStore } from '../../features/checkout/store/use-checkout-store';
import { offerPushPermission } from '../../features/notifications/lib/push-permission';

// Mount entrance: scale 0.5 -> 1 with a fade, driven by a spring.
const iconEntering = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.5 }] },
    animations: {
      opacity: withSpring(1, { damping: 15 }),
      transform: [{ scale: withSpring(1, { damping: 15 }) }],
    },
  };
};

export default function SuccessScreen() {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { t } = useTranslation('checkout');

  // Traemos el reset para limpiar residuos del proceso anterior
  const resetCheckout = useCheckoutStore((state) => state.resetCheckout);

  useEffect(() => {
    // 1. Feedback Táctil de Celebración
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // 2. Limpieza de Estado del Checkout (Para la próxima compra)
    // El carrito ya se limpió en payment.tsx, aquí limpiamos selección de UI
    resetCheckout();

    // First completed purchase: a moment with value to offer push (L6).
    void offerPushPermission('purchase');

    // 3. Bloqueo de Botón Atrás (Android)
    const backAction = () => {
      router.replace('/'); // Redirigir al inicio en lugar de atrás
      return true; // Prevenir comportamiento default
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    return () => backHandler.remove();
  }, [router, resetCheckout]);

  const handleGoToOrders = () => {
    router.replace('/profile/orders');
  };

  const handleGoHome = () => {
    router.dismiss();
  };

  return (
    <Box
      flex={1}
      backgroundColor="background"
      justifyContent="center"
      alignItems="center"
      padding="xl"
    >
      {/* gestureEnabled: false bloquea el swipe back en iOS */}
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      {/* Animación de Éxito */}
      <Animated.View entering={iconEntering}>
        <Box
          backgroundColor="success"
          width={100}
          height={100}
          borderRadius="xl"
          justifyContent="center"
          alignItems="center"
          style={{
            elevation: 10,
            shadowColor: theme.colors.success,
            shadowOpacity: 0.3,
            shadowRadius: 20,
          }}
        >
          <MaterialCommunityIcons name="check" size={60} color="white" />
        </Box>
      </Animated.View>

      <Text variant="header-xl" marginTop="xl" textAlign="center">
        {t('success.title')}
      </Text>

      <Text
        variant="body-md"
        color="textSecondary"
        textAlign="center"
        marginTop="m"
        marginBottom="xl"
      >
        {t('success.description')}
      </Text>

      <Box width="100%" gap="m">
        <PrimaryButton onPress={handleGoToOrders}>
          {t('success.viewOrders')}
        </PrimaryButton>

        <TouchableOpacity onPress={handleGoHome} style={{ padding: 10 }}>
          <Text
            variant="body-md"
            color="primary"
            textAlign="center"
            fontWeight="bold"
          >
            {t('success.backHome')}
          </Text>
        </TouchableOpacity>
      </Box>

      {/* Trust Signal */}
      <Box flexDirection="row" alignItems="center" marginTop="xl" opacity={0.6}>
        <MaterialCommunityIcons
          name="shield-check"
          size={16}
          color={theme.colors.textSecondary}
        />
        <Text variant="caption-md" color="textSecondary" marginLeft="xs">
          {t('success.secureText')}
        </Text>
      </Box>
    </Box>
  );
}
