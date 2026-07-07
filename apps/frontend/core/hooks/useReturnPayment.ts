import { useState } from 'react';
import { useStripe } from '@stripe/stripe-react-native';
import { useTheme } from '@shopify/restyle';
import * as Crypto from 'expo-crypto';
import Toast from 'react-native-toast-message';
import { invokeEdge } from '../services/edge-client';
import { Theme } from '../theme';
import { useTranslation } from 'react-i18next';

export const useReturnPayment = (disputeId: string) => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const theme = useTheme<Theme>();
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation('checkout');

  const handleReturnPayment = async () => {
    if (!disputeId) return { success: false, error: 'No dispute ID' };

    try {
      setLoading(true);

      // 1. Generar llave de idempotencia para evitar cobros dobles
      const idempotencyKey = Crypto.randomUUID();

      // 2. Llamar a la Edge Function
      const data = await invokeEdge('create-return-intent', {
        disputeId,
        idempotencyKey,
      });

      if (!data?.clientSecret) {
        throw new Error('Error al inicializar el pago');
      }

      // 3. Configurar el Payment Sheet (Estética Selene)
      const { error: stripeError } = await initPaymentSheet({
        merchantDisplayName: 'Selene Marketplace',
        paymentIntentClientSecret: data.clientSecret,
        customerId: data.customer,
        customerEphemeralKeySecret: data.ephemeralKey,
        allowsDelayedPaymentMethods: false,
        appearance: {
          shapes: { borderRadius: 12 },
          colors: {
            primary: theme.colors.primary,
            background: theme.colors.cardBackground,
            componentBackground: theme.colors.background,
            primaryText: theme.colors.textPrimary,
            secondaryText: theme.colors.textSecondary,
            placeholderText: theme.colors.textSecondary,
            icon: theme.colors.primary,
            error: theme.colors.error,
          },
        },
      });

      if (stripeError) throw new Error(stripeError.message);

      // 4. Mostrar pasarela de pago
      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code !== 'Canceled') {
          Toast.show({
            type: 'error',
            text1: t('payments.failedTitle') || 'Pago fallido',
            text2: presentError.message,
          });
        }
        return { success: false, cancelled: true };
      }

      // 5. Éxito
      Toast.show({
        type: 'success',
        text1: t('success.title') || '¡Pago exitoso!',
        text2: 'La guía de retorno se está generando.',
      });

      return { success: true };
    } catch (e: any) {
      console.error('[RETURN PAYMENT ERROR]', e);
      Toast.show({
        type: 'error',
        text1: 'Error técnico',
        text2: e.message,
      });
      return { success: false, error: e.message };
    } finally {
      setLoading(false);
    }
  };

  return { handleReturnPayment, loading };
};
