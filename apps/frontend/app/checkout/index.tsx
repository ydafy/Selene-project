/**
 * @file apps/frontend/app/checkout/index.tsx
 * @description Pantalla de Resumen de Compra y Validación Zod del Checkout de Selene.
 * @version 2.0 (Clean Architecture & Inline Validation)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import Toast from 'react-native-toast-message';

// Componentes Base
import { Box, Text as ThemedText } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { Checkbox } from '../../components/ui/Checkbox';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { AddressPickerModal } from '../../components/features/address/AddressPickerModal';
import { PaymentMethodPickerModal } from '../../components/features/checkout/PaymentMethodPickerModal';

// Componentes de Checkout
import { CheckoutItem } from '../../components/features/checkout/CheckoutItem';
import { AddressSection } from '../../components/features/checkout/AddressSection';
import { PaymentSection } from '../../components/features/checkout/PaymentSection';
import { SummaryBreakdown } from '../../components/features/checkout/SummaryBreakdown';

// Stores, Hooks y Servicios
import { useCartStore } from '../../core/store/useCartStore';
import { useCheckoutStore } from '../../core/store/useCheckoutStore';
import { useAddresses } from '../../core/hooks/useAddresses';
import { useOrderCalculations } from '../../core/hooks/useOrderCalculations';
import { usePaymentMethods } from '../../core/hooks/usePaymentMethods';
import { formatCurrency } from '../../core/utils/format';
import { Address } from '@selene/types';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { OrderService } from '../../core/services/order';
import { checkoutValidationSchema } from '../../core/schemas/checkout.schema';

export default function CheckoutSummaryScreen() {
  const { t } = useTranslation('checkout');
  const router = useRouter();
  const { session } = useAuthContext();

  // Modales
  const addressModalRef = useRef<BottomSheetModal>(null);
  const paymentModalRef = useRef<BottomSheetModal>(null);

  // Stores
  const cartItems = useCartStore((state) => state.items);
  const {
    selectedAddress,
    setSelectedAddress,
    selectedPaymentMethodId,
    setSelectedPaymentMethodId,
    status,
    setStatus,
    setError,
  } = useCheckoutStore();

  const { addresses, isLoading: loadingAddresses } = useAddresses();
  const { methods, isLoadingMethods } = usePaymentMethods();
  const { subtotal, serviceFee, total } = useOrderCalculations(cartItems);

  // Estados Locales
  const [showErrors, setShowErrors] = useState(false);
  const [isProtectionDialogVisible, setIsProtectionDialogVisible] =
    useState(false);
  const [unavailableItems, setUnavailableItems] = useState<string[]>([]);
  const [isTermsAccepted, setIsTermsAccepted] = useState(false);

  const selectedPaymentMethod = useMemo(
    () => methods.find((m) => m.id === selectedPaymentMethodId),
    [methods, selectedPaymentMethodId],
  );

  const isSelfPurchase = useMemo(
    () => cartItems.some((item) => item.seller_id === session?.user.id),
    [cartItems, session?.user.id],
  );

  // --- EFECTOS DE INICIALIZACIÓN ---
  useEffect(() => {
    setStatus('idle');
    setError(null);
    setShowErrors(false);
  }, [setStatus, setError]);

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

  // --- MANEJADORES ---
  const handleAddressSelect = (address: Address) => {
    setSelectedAddress(address);
    addressModalRef.current?.dismiss();
  };

  const onProceedToPayment = async () => {
    // 1. VALIDACIÓN DECLARATIVA CON ZOD
    const validation = checkoutValidationSchema.safeParse({
      addressId: selectedAddress?.id,
      paymentMethodId: selectedPaymentMethodId,
      isTermsAccepted,
    });

    if (!validation.success) {
      // Ilumina los campos en rojo en pantalla de forma visual sin popups molestos
      setShowErrors(true);
      return;
    }

    // 2. BLOQUEO DE AUTO-COMPRA
    if (isSelfPurchase) {
      Toast.show({
        type: 'error',
        text1: t('errors.selfPurchaseTitle'),
        text2: t('errors.selfPurchaseMsg'),
        position: 'top',
      });
      return;
    }

    // 3. VALIDACIÓN ATÓMICA DE STOCK
    setStatus('validating');
    setUnavailableItems([]);

    try {
      const stockCheck = await OrderService.validateProductStock(
        cartItems.map((i) => i.id),
      );

      if (!stockCheck.isValid) {
        setStatus('idle');
        setUnavailableItems(stockCheck.unavailableIds);
        Toast.show({
          type: 'error',
          text1: t('errors.stockTitle'),
          text2: t('errors.stockMsg'),
          position: 'top',
        });
        return;
      }

      // Navegación segura al flujo de pago
      setStatus('processing');
      router.push('/checkout/payment');
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : t('errors.genericMsg');
      setError(errorMessage);
      setStatus('error');
      Toast.show({
        type: 'error',
        text1: t('errors.genericTitle'),
        text2: errorMessage,
        position: 'top',
      });
    }
  };

  const isBusy = status === 'processing' || status === 'validating';

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

        {/* ALERTA DE AUTO-COMPRA */}
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

        {/* SECCIÓN DIRECCIÓN (Ilumina en rojo si falta) */}
        <AddressSection
          address={selectedAddress}
          onPress={() => addressModalRef.current?.present()}
          showError={showErrors && !selectedAddress}
          label={t('shipTo')}
          placeholder={t('address.select')}
          isLoading={loadingAddresses}
        />

        {/* SECCIÓN MÉTODO DE PAGO (Ilumina en rojo si falta) */}
        <PaymentSection
          method={selectedPaymentMethod}
          onPress={() => paymentModalRef.current?.present()}
          showError={showErrors && !selectedPaymentMethodId}
          isLoading={isLoadingMethods}
          label={t('payment.selectMethod')}
        />

        {/* LISTADO DE PRODUCTOS */}
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

        {/* DESGLOSE FINANCIERO */}
        <SummaryBreakdown
          subtotal={subtotal}
          serviceFee={serviceFee}
          total={total}
          onHelpPress={() => setIsProtectionDialogVisible(true)}
        />

        {/* TÉRMINOS Y CONDICIONES (Ilumina en rojo si falta) */}
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

      {/* BOTÓN INFERIOR DE PAGO */}
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
          disabled={cartItems.length === 0 || isBusy || isSelfPurchase}
          loading={isBusy}
        >
          {status === 'validating'
            ? t('summary.validating')
            : `${t('actions.pay')} ${formatCurrency(total)}`}
        </PrimaryButton>
      </Box>

      {/* DIÁLOGO INFORMATIVO DE PROTECCIÓN AL COMPRADOR */}
      <ConfirmDialog
        visible={isProtectionDialogVisible}
        title={t('dialogs.protectionTitle')}
        description={t('dialogs.protectionDesc')}
        icon="shield-check"
        confirmLabel={t('common:dialog.understood')}
        hideCancel
        onConfirm={() => setIsProtectionDialogVisible(false)}
        onCancel={() => setIsProtectionDialogVisible(false)}
      />

      <PaymentMethodPickerModal innerRef={paymentModalRef} />
      <AddressPickerModal
        innerRef={addressModalRef}
        onSelect={handleAddressSelect}
      />
    </Box>
  );
}
