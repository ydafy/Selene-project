import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { BottomSheetModal } from '@gorhom/bottom-sheet';

import { Box, Text } from '../../components/base';
import { Theme } from '../../core/theme';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { CheckoutItem } from '../../components/features/checkout/CheckoutItem';
import { CheckoutRow } from '../../components/features/checkout/CheckoutRow';
import { AddressPickerModal } from '../../components/features/address/AddressPickerModal';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { Checkbox } from '../../components/ui/Checkbox';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

import { useCartStore } from '../../core/store/useCartStore';
import { useCheckoutStore } from '../../core/store/useCheckoutStore';
import { useAddresses } from '../../core/hooks/useAddresses';
import { useOrderCalculations } from '../../core/hooks/useOrderCalculations';

import { formatCurrency } from '../../core/utils/format';
import { Address } from '@selene/types';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { supabase } from '../../core/db/supabase';

import { PaymentMethodRow } from '../../components/features/checkout/PaymentMethodRow';
import { PaymentMethodPickerModal } from '../../components/features/checkout/PaymentMethodPickerModal';
import { usePaymentMethods } from '../../core/hooks/usePaymentMethods';

export default function CheckoutSummaryScreen() {
  const { t } = useTranslation('checkout');
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { session } = useAuthContext();
  const addressModalRef = useRef<BottomSheetModal>(null);
  const paymentModalRef = useRef<BottomSheetModal>(null);

  const { methods, isLoadingMethods } = usePaymentMethods();
  const { selectedPaymentMethodId, setSelectedPaymentMethodId } =
    useCheckoutStore();

  // Encontrar el objeto completo de la tarjeta seleccionada
  const selectedPaymentMethod = useMemo(
    () => methods.find((m) => m.id === selectedPaymentMethodId),
    [methods, selectedPaymentMethodId],
  );

  // --- STATE ---
  const [isProtectionDialogVisible, setIsProtectionDialogVisible] =
    useState(false);
  const [isValidatingStock, setIsValidatingStock] = useState(false);
  const [isTermsAccepted, setIsTermsAccepted] = useState(false);

  // --- DATA ---
  const cartItems = useCartStore((state) => state.items);
  const { addresses } = useAddresses();
  const { selectedAddress, setSelectedAddress } = useCheckoutStore();

  // --- LOGIC ---
  const isSelfPurchase = useMemo(() => {
    return cartItems.some((item) => item.seller_id === session?.user.id);
  }, [cartItems, session?.user.id]);

  // --- EFFECTS ---
  useEffect(() => {
    if (!addresses) return;
    const isSelectedValid =
      selectedAddress && addresses.find((a) => a.id === selectedAddress.id);
    if (!selectedAddress || !isSelectedValid) {
      if (addresses.length > 0) {
        const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
        setSelectedAddress(defaultAddr);
      }
    }
  }, [addresses, selectedAddress, setSelectedAddress]);

  useEffect(() => {
    if (!isLoadingMethods && methods.length > 0 && !selectedPaymentMethodId) {
      // Seleccionamos la default o la primera de la lista
      const defaultMethod = methods.find((m) => m.is_default) || methods[0];
      setSelectedPaymentMethodId(defaultMethod.id);
    }
  }, [methods, isLoadingMethods, selectedPaymentMethodId]);

  // --- CALCULATIONS ---
  // Al no haber shippingMethods seleccionados, shippingCost será 0 automáticamente.
  const { subtotal, serviceFee, total } = useOrderCalculations(cartItems);

  const onProceedToPayment = async () => {
    if (!selectedAddress) {
      Alert.alert(t('actions.selectAddress'));
      addressModalRef.current?.present();
      return;
    }
    setIsValidatingStock(true);
    try {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, status')
        .in(
          'id',
          cartItems.map((i) => i.id),
        );

      const unavailableItem = products?.find((p) => p.status !== 'VERIFIED');
      if (unavailableItem) {
        Alert.alert(
          'No disponible',
          t('errors.itemUnavailable', { productName: unavailableItem.name }),
        );
        return;
      }
      router.push('/checkout/payment' as never);
    } catch {
      Alert.alert('Error', 'No se pudo validar la disponibilidad.');
    } finally {
      setIsValidatingStock(false);
    }
  };

  const handleAddressSelect = (address: Address) => {
    setSelectedAddress(address);
    addressModalRef.current?.dismiss();
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
            <Text
              color="textPrimary"
              variant="body-sm"
              fontWeight="bold"
              marginLeft="s"
              flex={1}
            >
              {t('errors.selfPurchase')}
            </Text>
          </Box>
        )}

        {/* DIRECCIÓN */}
        <Box marginBottom="l">
          <Text variant="subheader-lg" marginBottom="s" color="primary">
            {t('shipTo')}
          </Text>
          <TouchableOpacity
            onPress={() => addressModalRef.current?.present()}
            activeOpacity={0.7}
          >
            <Box
              backgroundColor="cardBackground"
              padding="m"
              borderRadius="m"
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              borderWidth={1}
              borderColor={selectedAddress ? 'transparent' : 'error'}
            >
              <Box flex={1} flexDirection="row" alignItems="center">
                <MaterialCommunityIcons
                  name="map-marker-outline"
                  size={24}
                  color={theme.colors.primary}
                />
                <Box marginLeft="m">
                  {selectedAddress ? (
                    <>
                      <Text variant="body-md" fontWeight="bold">
                        {selectedAddress.full_name}
                      </Text>
                      <Text
                        variant="caption-md"
                        color="textSecondary"
                        numberOfLines={1}
                      >
                        {selectedAddress.street_line1}, {selectedAddress.city}
                      </Text>
                    </>
                  ) : (
                    <Text variant="body-md" color="textSecondary">
                      {t('address.select')}
                    </Text>
                  )}
                </Box>
              </Box>
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={theme.colors.textSecondary}
              />
            </Box>
          </TouchableOpacity>
        </Box>

        {/* --- SECCIÓN: MÉTODO DE PAGO --- */}
        <Box marginBottom="l">
          <Text variant="subheader-lg" marginBottom="s" color="primary">
            Método de pago
          </Text>
          <PaymentMethodRow
            method={selectedPaymentMethod}
            onPress={() => paymentModalRef.current?.present()}
            error={!selectedPaymentMethodId} // Opcional: marcar en rojo si falta
          />
        </Box>

        {/* PRODUCTOS */}
        <Box marginBottom="l">
          <Text variant="subheader-lg" marginBottom="s" color="primary">
            {t('products')} ({cartItems.length})
          </Text>
          {cartItems.map((item) => (
            <Box key={item.id} marginBottom="m">
              <CheckoutItem product={item} />
            </Box>
          ))}
        </Box>

        {/* RESUMEN DE COSTOS */}
        <Box backgroundColor="cardBackground" padding="m" borderRadius="l">
          <CheckoutRow
            label={t('summary.subtotal')}
            value={formatCurrency(subtotal)}
          />

          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Box flexDirection="row" alignItems="center">
              <Text variant="body-md" color="textSecondary">
                Protección Selene
              </Text>
              <TouchableOpacity
                onPress={() => setIsProtectionDialogVisible(true)}
                style={{ marginLeft: 6 }}
              >
                <MaterialCommunityIcons
                  name="help-circle-outline"
                  size={16}
                  color={theme.colors.primary}
                />
              </TouchableOpacity>
            </Box>
            <Text variant="body-md" color="textPrimary">
              {formatCurrency(serviceFee)}
            </Text>
          </Box>

          <Box
            flexDirection="row"
            justifyContent="space-between"
            marginBottom="s"
          >
            <Text variant="body-md" color="textSecondary">
              {t('summary.shipping')}
            </Text>
            {/* Siempre Gratis visualmente */}
            <Text variant="body-md" color="success" fontWeight="bold">
              Gratis
            </Text>
          </Box>

          <Box height={1} backgroundColor="background" marginVertical="m" />

          <Box flexDirection="row" justifyContent="space-between">
            <Text variant="subheader-lg">{t('summary.totalToPay')}</Text>
            <Text variant="subheader-lg" color="primary" fontWeight="bold">
              {formatCurrency(total)}
            </Text>
          </Box>
        </Box>

        {/* TÉRMINOS */}
        <Box marginTop="l" paddingHorizontal="s">
          <Checkbox
            status={isTermsAccepted ? 'checked' : 'unchecked'}
            onPress={() => setIsTermsAccepted(!isTermsAccepted)}
            label={
              <Text variant="body-sm" color="textSecondary" marginLeft="s">
                {t('summary.termsText')}
              </Text>
            }
          />
        </Box>
      </ScrollView>

      {/* FOOTER */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        padding="m"
        paddingBottom="xl"
        borderTopWidth={1}
        borderTopColor="background"
        backgroundColor="background"
      >
        <PrimaryButton
          onPress={onProceedToPayment}
          disabled={
            cartItems.length === 0 ||
            !selectedAddress ||
            isValidatingStock ||
            !selectedPaymentMethodId ||
            isSelfPurchase ||
            !isTermsAccepted
          }
          loading={isValidatingStock}
        >
          {isValidatingStock
            ? t('summary.validating')
            : `${t('actions.pay')} ${formatCurrency(total)}`}
        </PrimaryButton>
      </Box>

      <ConfirmDialog
        visible={isProtectionDialogVisible}
        title={t('dialogs.title', { defaultValue: 'Protección Selene' })}
        description={t('dialogs.description', {
          defaultValue:
            'Tu dinero está seguro hasta que recibes el producto tal como se describió.',
        })}
        icon="shield-check"
        confirmLabel="Entendido"
        hideCancel={true}
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
