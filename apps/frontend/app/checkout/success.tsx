import React, { useEffect } from 'react';
import { BackHandler, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';

import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { Theme } from '../../core/theme';
import { useCheckoutStore } from '../../core/store/useCheckoutStore';

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
    // Usamos replace para matar el stack de navegación del checkout
    router.replace('/(tabs)/profile');
    // Nota: Aquí idealmente navegarías a una ruta específica como '/orders'
    // si existiera, o al tab de perfil donde están las órdenes.
  };

  const handleGoHome = () => {
    router.replace('/');
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
      <MotiView
        from={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 15 }}
      >
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
      </MotiView>

      <Text variant="header-xl" marginTop="xl" textAlign="center">
        {t('success.title', { defaultValue: '¡Pago Confirmado!' })}
      </Text>

      <Text
        variant="body-md"
        color="textSecondary"
        textAlign="center"
        marginTop="m"
        marginBottom="xl"
      >
        {t('success.description', {
          defaultValue:
            'Tu hardware ha sido apartado. El vendedor recibirá la guía de envío en breve.',
        })}
      </Text>

      <Box width="100%" gap="m">
        <PrimaryButton onPress={handleGoToOrders}>
          {t('success.viewOrders', { defaultValue: 'Ir a Mis Pedidos' })}
        </PrimaryButton>

        <TouchableOpacity onPress={handleGoHome} style={{ padding: 10 }}>
          <Text
            variant="body-md"
            color="primary"
            textAlign="center"
            fontWeight="bold"
          >
            {t('success.backHome', { defaultValue: 'Volver al Inicio' })}
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
