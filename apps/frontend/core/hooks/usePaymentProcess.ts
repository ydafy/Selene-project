/**
 * @file apps/frontend/core/hooks/usePaymentProcess.ts
 * @description Core Custom React Hook for orchestrating sequential multi-seller Stripe Connect payments.
 *
 * Implements:
 * 1. Single-modal Stripe PaymentSheet checkout using one platform PaymentIntent.
 * 2. Cleanup via rollback-connect-payment when the prepared session becomes stale.
 * 3. Race condition prevention using an asynchronous queue (lifecycleQueue) to serialize DB reservations and releases.
 * 4. Stale API response prevention using an atomic versioning counter (prepareVersion) for rapid checkout input changes.
 * 5. Automatic cleanup releasing reserved products upon screen unmounting.
 *
 * @version 1.3
 * @domain mobile-checkout-hooks
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useStripe } from '@stripe/stripe-react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Crypto from 'expo-crypto';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

import { useCartStore } from '../store/useCartStore';
import { useCheckoutStore } from '../store/useCheckoutStore';
import { supabase } from '../db/supabase';
import { invokeEdge } from '../services/edge-client';
import {
  buildConnectPaymentRequest,
  ConnectPaymentResponseSchema,
  normalizeConnectPaymentResponse,
  paymentIntentIdFromClientSecret,
  type NormalizedConnectPayment,
} from '../utils/connectPayment';
import { presentSinglePaymentSheet } from '../utils/checkoutPaymentFlow';

interface CheckoutInputSnapshot {
  addressId: string | null;
  productIds: string[];
}

interface CheckoutSessionSnapshot {
  productIds: string[];
  orderId: string | null;
  paymentIntentId: string | null;
}

export const usePaymentProcess = () => {
  const { t } = useTranslation('checkout');
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const router = useRouter();
  const theme = useTheme<Theme>();
  const [isConfirming, setIsConfirming] = useState(false);

  const [loading, setLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentData, setPaymentData] = useState<NormalizedConnectPayment | null>(
    null,
  );

  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clearCart);
  const { selectedAddress, setStatus, setPaymentSession, clearPaymentSession } =
    useCheckoutStore();

  const isPaymentSuccessful = useRef(false);
  const isMounted = useRef(true);
  const prepareVersion = useRef(0);
  const lifecycleQueue = useRef<Promise<void>>(Promise.resolve());
  const activeSession = useRef<CheckoutSessionSnapshot | null>(null);

  const enqueueLifecycle = useCallback(<T>(operation: () => Promise<T>) => {
    const queued = lifecycleQueue.current.then(operation, operation);

    lifecycleQueue.current = queued.then(
      () => undefined,
      () => undefined,
    );

    return queued;
  }, []);

  const canWriteState = useCallback((version: number) => {
    return isMounted.current && version === prepareVersion.current;
  }, []);

  const releaseProductIds = useCallback(async (productIds: string[]) => {
    if (productIds.length === 0 || isPaymentSuccessful.current) return;

    try {
      await supabase.rpc('fn_release_products', { p_product_ids: productIds });
      if (__DEV__) console.log('[PAYMENT] Products released successfully');
    } catch (e) {
      console.error('[PAYMENT] Error releasing products:', e);
    }
  }, []);

  const rollbackOrReleaseSession = useCallback(
    async (session: CheckoutSessionSnapshot) => {
      if (isPaymentSuccessful.current) return;

      if (session.orderId && session.paymentIntentId) {
        try {
          const { data: rollbackData, error: rollbackError } = await supabase
            .functions.invoke('rollback-connect-payment', {
              body: {
                orderId: session.orderId,
                paymentIntentIds: [session.paymentIntentId],
              },
            });

          if (rollbackError) {
            throw rollbackError;
          }

          const rolledBack =
            (rollbackData as { rolledBack?: number } | null)?.rolledBack ?? 0;

          if (rolledBack > 0) {
            return;
          }
        } catch (rollbackError) {
          console.error('[PAYMENT_ROLLBACK_ERROR]', rollbackError);
        }
      }

      await releaseProductIds(session.productIds);
    },
    [releaseProductIds],
  );

  const disposeActiveSession = useCallback(async () => {
    const session = activeSession.current;
    activeSession.current = null;

    if (!session || isPaymentSuccessful.current) return;

    await rollbackOrReleaseSession(session);
  }, [rollbackOrReleaseSession]);

  const preparePayment = useCallback(
    async (snapshot: CheckoutInputSnapshot, version: number) => {
      await disposeActiveSession();

      if (!canWriteState(version)) return;

      if (!snapshot.addressId) {
        setError(t('payment.noAddressError'));
        setLoading(false);
        return;
      }

      if (snapshot.productIds.length === 0) {
        setError(t('payment.genericError'));
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const idempotencyKey = Crypto.randomUUID();

        let data: Awaited<
          ReturnType<typeof invokeEdge<'create-connect-payment'>>
        >;
        try {
          data = await invokeEdge(
            'create-connect-payment',
            buildConnectPaymentRequest({
              items: snapshot.productIds.map((id) => ({ id })),
              addressId: snapshot.addressId,
              idempotencyKey,
            }),
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage === 'RESERVATION_FAILED') {
            await releaseProductIds(snapshot.productIds);
            if (canWriteState(version)) setError(t('payment.outOfStockMsg'));
          } else if (errorMessage === 'SELLER_NOT_ONBOARDED') {
            await releaseProductIds(snapshot.productIds);
            if (canWriteState(version)) {
              setError(
                'Seller onboarding is required before checkout for one or more items.',
              );
            }
          } else if (canWriteState(version)) {
            setError(t('payment.genericError'));
          }

          return;
        }

        const validatedData = normalizeConnectPaymentResponse(
          ConnectPaymentResponseSchema.parse(data),
        );
        const preparedSession: CheckoutSessionSnapshot = {
          productIds: [...snapshot.productIds],
          orderId: validatedData.orderId,
          paymentIntentId: paymentIntentIdFromClientSecret(
            validatedData.clientSecret,
          ),
        };

        if (!canWriteState(version)) {
          await rollbackOrReleaseSession(preparedSession);
          return;
        }

        activeSession.current = preparedSession;
        setPaymentData(validatedData);
        setPaymentSession({
          amount: validatedData.amount,
          clientSecret: validatedData.clientSecret,
          orderId: validatedData.orderId,
          transferGroup: validatedData.transferGroup,
        });
        setIsReady(true);
      } catch (e: unknown) {
        await releaseProductIds(snapshot.productIds);

        if (!canWriteState(version)) return;

        const errorMessage = e instanceof Error ? e.message : String(e);

        console.error('[PAYMENT_HOOK_ERROR]', errorMessage);
        setError(t('payment.criticalError'));
      } finally {
        if (canWriteState(version)) setLoading(false);
      }
    },
    [
      canWriteState,
      disposeActiveSession,
      releaseProductIds,
      rollbackOrReleaseSession,
      setPaymentSession,
      t,
    ],
  );

  const queuePreparePayment = useCallback(
    async (snapshot: CheckoutInputSnapshot) => {
      if (isPaymentSuccessful.current) return;

      const version = prepareVersion.current + 1;
      prepareVersion.current = version;

      if (isMounted.current) {
        setLoading(true);
        setError(null);
        setIsReady(false);
        setPaymentData(null);
        clearPaymentSession();
      }

      await enqueueLifecycle(() => preparePayment(snapshot, version));
    },
    [clearPaymentSession, enqueueLifecycle, preparePayment],
  );

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
      prepareVersion.current += 1;

      if (!isPaymentSuccessful.current) {
        void enqueueLifecycle(async () => {
          await disposeActiveSession();
          setStatus('idle');
          if (__DEV__) console.log('[PAYMENT] Global state reset to IDLE');
        });
      }
    };
  }, [disposeActiveSession, enqueueLifecycle, setStatus]);

  useEffect(() => {
    const snapshot: CheckoutInputSnapshot = {
      addressId: selectedAddress?.id ?? null,
      productIds: items.map((item) => item.id),
    };

    void queuePreparePayment(snapshot);

    return () => {
      prepareVersion.current += 1;
    };
  }, [items, selectedAddress?.id, queuePreparePayment]);

  const handlePayment = async () => {
    const paymentSnapshot = paymentData;

    if (!paymentSnapshot) {
      return { success: false, message: t('payment.criticalError') };
    }

    const result = await presentSinglePaymentSheet({
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
      customerEphemeralKeySecret: paymentSnapshot.ephemeralKey,
      customerId: paymentSnapshot.customer,
      initPaymentSheet,
      merchantDisplayName: 'Selene Marketplace',
      paymentIntentClientSecret: paymentSnapshot.clientSecret,
      presentPaymentSheet,
    });

    if (!result.success) {
      if (result.cancelled) {
        return { success: false, cancelled: true };
      }

      return { success: false, message: result.message };
    }

    isPaymentSuccessful.current = true;
    activeSession.current = null;
    clearPaymentSession();
    setIsConfirming(true);
    setStatus('success');
    clearCart();
    setTimeout(() => {
      router.replace('/checkout/success');
    }, 500);
    return { success: true };
  };

  const handleRetry = async () => {
    await queuePreparePayment({
      addressId: selectedAddress?.id ?? null,
      productIds: items.map((item) => item.id),
    });
  };

  return {
    loading,
    isReady,
    isConfirming,
    error,
    paymentData,
    handlePayment,
    retry: handleRetry,
  };
};
