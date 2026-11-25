/* eslint-disable @typescript-eslint/no-explicit-any */
import { ScrollView } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { Box } from '@/shared/ui/base';
import { ProfileActionButton } from './profile-action-button';
import { Theme } from '@/shared/theme';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useCallback, useRef, useState } from 'react';
import { AddressPickerModal } from '@/shared/ui/address/address-picker-modal';
import { Address } from '@selene/types';
import { useAddresses } from '@/shared/hooks/use-addresses';
import { useCheckoutStore } from '@/shared/store/use-checkout-store';
import { PaymentMethodsSheet } from './payment-methods-sheet';

export const ProfileActionsBar = () => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('profile');
  const router = useRouter();
  const addressModalRef = useRef<BottomSheetModal>(null);
  const { setDefault } = useAddresses();
  const { setSelectedAddress } = useCheckoutStore();
  const [isPaymentMethodsVisible, setIsPaymentMethodsVisible] = useState(false);
  const [isPaymentMethodsPreparing, setIsPaymentMethodsPreparing] =
    useState(false);

  const handleOpenAddressPicker = useCallback(() => {
    addressModalRef.current?.present();
  }, []);

  const handleAddressChange = useCallback(
    (address: Address) => {
      setDefault(address.id);
      setSelectedAddress(address);
      addressModalRef.current?.dismiss();
    },
    [setDefault, setSelectedAddress],
  );

  const actions = [
    {
      label: t('menu.orders'),
      icon: 'package-variant-closed',
      onPress: () => router.push('/profile/orders'),
    },
    {
      label: t('menu.listings'),
      icon: 'tag-multiple-outline',
      onPress: () => router.push('/profile/listings'),
    },
    {
      label: t('menu.addresses'),
      icon: 'map-marker-outline',
      onPress: () => handleOpenAddressPicker(),
    },
    {
      label: t('menu.paymentMethods'),
      icon: 'credit-card-multiple-outline',
      onPress: () => setIsPaymentMethodsVisible(true),
      loading: isPaymentMethodsPreparing,
    },
    {
      label: t('menu.payments'),
      icon: 'credit-card-outline',
      onPress: () => router.push('/sell/onboarding'),
    },
  ];

  return (
    <Box
      marginHorizontal="m"
      marginTop="m"
      backgroundColor="cardBackground"
      borderRadius="l"
      paddingVertical="m"
      position="relative"
      style={{
        shadowColor: theme.colors.shadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
      >
        {actions.map((action, index) => (
          <ProfileActionButton
            key={index}
            label={action.label}
            icon={action.icon as any}
            onPress={action.onPress}
            loading={action.loading}
          />
        ))}
      </ScrollView>

      {/* Efecto Fade a la derecha */}
      <LinearGradient
        colors={['transparent', theme.colors.cardBackground]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 24,
          borderTopRightRadius: theme.borderRadii.l,
          borderBottomRightRadius: theme.borderRadii.l,
        }}
        pointerEvents="none"
      />
      <AddressPickerModal
        innerRef={addressModalRef}
        onSelect={handleAddressChange}
      />
      <PaymentMethodsSheet
        visible={isPaymentMethodsVisible}
        onClose={() => setIsPaymentMethodsVisible(false)}
        onPreparingChange={setIsPaymentMethodsPreparing}
      />
    </Box>
  );
};
