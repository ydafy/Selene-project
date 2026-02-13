import { useState, useEffect, useCallback, useRef } from 'react';
import { useStripe } from '@stripe/stripe-react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

import { useCartStore } from '../store/useCartStore';
import { useCheckoutStore } from '../store/useCheckoutStore';
import { supabase } from '../db/supabase';

const PaymentResponseSchema = z.object({
  clientSecret: z.string(),
  ephemeralKey: z.string(),
  customer: z.string(),
  amount: z.number(),
});

export const usePaymentProcess = () => {
  const { t } = useTranslation('checkout');
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const router = useRouter();
  const theme = useTheme<Theme>();
  const [isConfirming, setIsConfirming] = useState(false);

  const [loading, setLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentData, setPaymentData] = useState<z.infer<
    typeof PaymentResponseSchema
  > | null>(null);

  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const { selectedAddress, setStatus } = useCheckoutStore();

  // Ref para saber si el pago fue exitoso y evitar liberar stock por error al desmontar
  const isPaymentSuccessful = useRef(false);

  // FUNCIÓN PARA LIBERAR PRODUCTOS (Rollback)
  const releaseProducts = useCallback(async () => {
    try {
      const productIds = items.map((i) => i.id);
      await supabase.rpc('fn_release_products', { p_product_ids: productIds });
      if (__DEV__) console.log('[PAYMENT] Productos liberados con éxito');
    } catch (e) {
      console.error('[PAYMENT] Error al liberar productos:', e);
    }
  }, [items]);

  const preparePayment = useCallback(async () => {
    if (!selectedAddress?.id) {
      setError(t('payment.noAddressError'));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const idempotencyKey = Crypto.randomUUID();
      const { data, error: funcError } = await supabase.functions.invoke(
        'create-payment-intent',
        {
          body: {
            productIds: items.map((i) => i.id),
            addressId: selectedAddress.id,
            idempotencyKey,
          },
        },
      );

      if (funcError) {
        const status = (funcError as any).status;
        // Si el error es stock, intentamos liberar por si acaso quedó algo trabado
        if (status === 409) {
          await releaseProducts();
          setError(t('payment.outOfStockMsg'));
        } else {
          setError(t('payment.genericError'));
        }
        return;
      }

      const validatedData = PaymentResponseSchema.parse(data);
      setPaymentData(validatedData);

      const { error: stripeError } = await initPaymentSheet({
        merchantDisplayName: 'Selene Marketplace',
        paymentIntentClientSecret: validatedData.clientSecret,
        customerId: validatedData.customer,
        customerEphemeralKeySecret: validatedData.ephemeralKey,
        allowsDelayedPaymentMethods: false,
        appearance: {
          shapes: { borderRadius: 12 },
          colors: {
            primary: theme.colors.primary,
            background: theme.colors.cardBackground,
            componentBackground: theme.colors.background,
            componentBorder: theme.colors.separator,
            componentDivider: theme.colors.separator,
            primaryText: theme.colors.textPrimary,
            secondaryText: theme.colors.textSecondary,
            componentText: theme.colors.textPrimary,
            placeholderText: theme.colors.textSecondary,
            icon: theme.colors.primary,
            error: theme.colors.error,
          },
        },
      });

      if (stripeError) throw new Error(stripeError.message);
      setIsReady(true);
    } catch (e: any) {
      console.error('[PAYMENT HOOK ERROR]', e);
      setError(t('payment.criticalError'));
    } finally {
      setLoading(false);
    }
  }, [items, selectedAddress, t, initPaymentSheet, releaseProducts, theme]);

  // EFECTO DE LIMPIEZA (CLEANUP)
  useEffect(() => {
    preparePayment();

    return () => {
      // Si el usuario sale de la pantalla y NO ha pagado, liberamos el stock
      if (!isPaymentSuccessful.current) {
        releaseProducts();
        setStatus('idle');
        if (__DEV__) console.log('[PAYMENT] Estado global reseteado a IDLE');
      }
    };
  }, [preparePayment, releaseProducts, setStatus]); // Solo al montar y desmontar

  const handlePayment = async () => {
    const { error: sheetError } = await presentPaymentSheet();

    if (sheetError) {
      if (sheetError.code !== 'Canceled') {
        return { success: false, message: sheetError.message };
      }
      return { success: false, cancelled: true };
    }

    // MARCAR COMO ÉXITO ANTES DE NAVEGAR
    setIsConfirming(true);
    isPaymentSuccessful.current = true;
    setStatus('success');
    clearCart();
    setTimeout(() => {
      router.replace('/checkout/success' as never);
    }, 500);
    return { success: true };
  };

  const handleRetry = async () => {
    // Para reintentar, primero nos aseguramos de que el stock esté libre
    await releaseProducts();
    preparePayment();
  };

  return {
    loading,
    isReady,
    isConfirming,
    error,
    paymentData,
    handlePayment,
    retry: handleRetry, // Usamos la versión con liberación
  };
};
