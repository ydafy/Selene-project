/**
 * @file apps/frontend/app/checkout/index.tsx
 * @description Buyer-facing Checkout Summary and Order Review Screen.
 *
 * Implements:
 * 1. Sequential review of cart items grouped by seller (multi-seller checkout preview).
 * 2. Strict client-side validation gates: terms acceptance, self-purchase blocking, and address/payment completeness.
 * 3. Pre-payment atomic stock validation via OrderService.validateProductStock.
 * 4. Renders pricing breakdown (Subtotal, Seguro Selene, and shipping cost) aligned with backend cents math.
 *
 * Uses Shopify Restyle for responsive dark/light theme tokens and safe-area notch padding.
 *
 * @version 1.2
 * @domain mobile-checkout-screens
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { BottomSheetModal } from '@gorhom/bottom-sheet';

// FIX: Renombramos Text para evitar conflicto con la interfaz Text del DOM
import { Box, Text as ThemedText } from '../../components/base';

import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { Checkbox } from '../../components/ui/Checkbox';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { AddressPickerModal } from '../../components/features/address/AddressPickerModal';
import { PaymentMethodPickerModal } from '../../components/features/checkout/PaymentMethodPickerModal';

// Componentes Fragmentados
import { CheckoutItem } from '../../components/features/checkout/CheckoutItem';
import { AddressSection } from '../../components/features/checkout/AddressSection';
import { PaymentSection } from '../../components/features/checkout/PaymentSection';
import { SummaryBreakdown } from '../../components/features/checkout/SummaryBreakdown';

// Hooks y Stores
import { useCartStore } from '../../core/store/useCartStore';
import { useCheckoutStore } from '../../core/store/useCheckoutStore';
import { useAddresses } from '../../core/hooks/useAddresses';
import { useOrderCalculations } from '../../core/hooks/useOrderCalculations';
import { usePaymentMethods } from '../../core/hooks/usePaymentMethods';
import { formatCurrency } from '../../core/utils/format';
import { Address } from '@selene/types';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { OrderService } from '../../core/services/order';

export default function CheckoutSummaryScreen() {
  const { t } = useTranslation('checkout');

  const router = useRouter();
  const { session } = useAuthContext();

  // Refs
  const addressModalRef = useRef<BottomSheetModal>(null);
  const paymentModalRef = useRef<BottomSheetModal>(null);

  // Stores & Hooks
  const cartItems = useCartStore((state) => state.items);
  const {
    selectedAddress,
    setSelectedAddress,
    selectedPaymentMethodId,
    setSelectedPaymentMethodId,
    status,
    setStatus,
    setError,
    isReady,
  } = useCheckoutStore();

  const { addresses, isLoading: loadingAddresses } = useAddresses();
  const { methods, isLoadingMethods } = usePaymentMethods();
  const { subtotal, serviceFee, total } = useOrderCalculations(cartItems);
  // UI Local State
  const [showErrors, setShowErrors] = useState(false);
  const [isProtectionDialogVisible, setIsProtectionDialogVisible] =
    useState(false);
  const [isValidationDialogVisible, setIsValidationDialogVisible] =
    useState(false);
  const [unavailableItems, setUnavailableItems] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isValidatingStock, setIsValidatingStock] = useState(false);
  const [isTermsAccepted, setIsTermsAccepted] = useState(false);

  // Memoized Data
  const selectedPaymentMethod = useMemo(
    () => methods.find((m) => m.id === selectedPaymentMethodId),
    [methods, selectedPaymentMethodId],
  );

  const isSelfPurchase = useMemo(
    () => cartItems.some((item) => item.seller_id === session?.user.id),
    [cartItems, session?.user.id],
  );

  // --- EFFECTS ---
  useEffect(() => {
    setStatus('idle');
    setError(null);
  }, []);

  useEffect(() => {
    if (!loadingAddresses && addresses.length > 0 && !selectedAddress) {
      const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
      setSelectedAddress(defaultAddr);
    }
  }, [addresses, loadingAddresses, selectedAddress, setSelectedAddress]);

  useEffect(() => {
    if (!isLoadingMethods && methods.length > 0 && !selectedPaymentMethodId) {
      const defaultMethod = methods.find((m) => m.is_default) || methods[0];
      setSelectedPaymentMethodId(defaultMethod.id);
    }
  }, [
    methods,
    isLoadingMethods,
    selectedPaymentMethodId,
    setSelectedPaymentMethodId,
  ]);

  // --- HANDLERS ---
  const handleAddressSelect = (address: Address) => {
    setSelectedAddress(address);
    addressModalRef.current?.dismiss();
  };

  const onProceedToPayment = async () => {
    if (!isReady() || !isTermsAccepted) {
      setShowErrors(true);
      setIsValidationDialogVisible(true);
      return;
    }

    if (isSelfPurchase) {
      Alert.alert(t('errors.selfPurchaseTitle'), t('errors.selfPurchaseMsg'));
      return;
    }

    // LÓGICA DE VALIDACIÓN BLINDADA---
    setIsValidatingStock(true);
    setStatus('validating');
    setUnavailableItems([]);

    try {
      const validation = await OrderService.validateProductStock(
        cartItems.map((i) => i.id),
      );

      if (!validation.isValid) {
        setStatus('idle');
        setUnavailableItems(validation.unavailableIds);
        Alert.alert(t('errors.stockTitle'), t('errors.stockMsg'));
        return;
      }

      //  Navegar al Pago (Si todo es válido)
      setStatus('processing');
      router.push('/checkout/payment');
    } catch (err: unknown) {
      // ELIMINAMOS ANY: Manejo de error robusto
      const errorMessage =
        err instanceof Error ? err.message : t('errors.genericMsg');
      setError(errorMessage);
      setStatus('error');
      Alert.alert(t('errors.genericTitle'), errorMessage);
    } finally {
      setIsValidatingStock(false);
    }
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader
        title={t('confirmPurchase')}
        showBack={true}
        backgroundColor="cardBackground"
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 150,
          paddingTop: 140,
        }}
      >
        <ScreenHeader title={t('orderSummary')} subtitle={t('reviewDetails')} />

        {/* ALERTA AUTO-COMPRA */}
        {isSelfPurchase && (
          <Box
            backgroundColor="error"
            padding="m"
            borderRadius="m"
            marginBottom="l"
            flexDirection="row"
            alignItems="center"
          >
            <MaterialCommunityIcons
              name="alert-octagon"
              size={20}
              color="white"
            />
            <ThemedText
              color="textPrimary"
              variant="body-sm"
              fontWeight="bold"
              marginLeft="s"
              flex={1}
            >
              {t('errors.selfPurchase')}
            </ThemedText>
          </Box>
        )}

        <AddressSection
          address={selectedAddress}
          onPress={() => addressModalRef.current?.present()}
          showError={showErrors}
          label={t('shipTo')}
          placeholder={t('address.select')}
          isLoading={loadingAddresses}
        />

        <PaymentSection
          method={selectedPaymentMethod}
          onPress={() => paymentModalRef.current?.present()}
          showError={showErrors}
          label={t('payment.selectMethod')}
        />

        <Box marginBottom="l">
          <ThemedText variant="subheader-lg" marginBottom="s" color="primary">
            {t('products')} ({cartItems.length})
          </ThemedText>
          {cartItems.map((item) => (
            <CheckoutItem
              key={item.id}
              product={item}
              isUnavailable={unavailableItems.includes(item.id)}
            />
          ))}
        </Box>

        <SummaryBreakdown
          subtotal={subtotal}
          serviceFee={serviceFee}
          total={total}
          onHelpPress={() => setIsProtectionDialogVisible(true)}
        />

        <Box
          marginTop="l"
          padding="l"
          borderRadius="s"
          borderWidth={showErrors && !isTermsAccepted ? 1 : 0}
          borderColor="error"
        >
          <Checkbox
            status={isTermsAccepted ? 'checked' : 'unchecked'}
            onPress={() => setIsTermsAccepted(!isTermsAccepted)}
            label={
              <ThemedText
                variant="body-sm"
                color={
                  showErrors && !isTermsAccepted ? 'error' : 'textSecondary'
                }
                marginLeft="s"
              >
                {t('summary.termsText')}
              </ThemedText>
            }
          />
        </Box>
      </ScrollView>

      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        padding="m"
        paddingBottom="xl"
        borderTopColor="background"
        backgroundColor="transparent"
      >
        <PrimaryButton
          onPress={onProceedToPayment}
          disabled={
            cartItems.length === 0 ||
            status === 'processing' ||
            status === 'validating'
          }
          loading={status === 'processing' || status === 'validating'}
        >
          {status === 'validating'
            ? t('summary.validating')
            : `${t('actions.pay')} ${formatCurrency(total)}`}
        </PrimaryButton>
      </Box>

      {/* DIÁLOGOS */}
      <ConfirmDialog
        visible={isProtectionDialogVisible}
        title={t('dialogs.protectionTitle')}
        description={t('dialogs.protectionDesc')}
        icon="shield-check"
        confirmLabel={t('common:understand')}
        hideCancel
        onConfirm={() => setIsProtectionDialogVisible(false)}
        onCancel={() => setIsProtectionDialogVisible(false)}
      />

      <ConfirmDialog
        visible={isValidationDialogVisible}
        title={t('errors.incompleteTitle')}
        description={t('errors.incompleteMsg')}
        icon="alert-circle-outline"
        confirmLabel={t('common:understand')}
        hideCancel
        onConfirm={() => setIsValidationDialogVisible(false)}
        onCancel={() => setIsValidationDialogVisible(false)}
      />

      <PaymentMethodPickerModal innerRef={paymentModalRef} />
      <AddressPickerModal
        innerRef={addressModalRef}
        onSelect={handleAddressSelect}
      />
    </Box>
  );
}
