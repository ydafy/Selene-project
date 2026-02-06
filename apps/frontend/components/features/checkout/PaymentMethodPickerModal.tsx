import React, { useCallback, useMemo } from 'react';
import {
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useStripe } from '@stripe/stripe-react-native';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { usePaymentMethods } from '../../../core/hooks/usePaymentMethods';
import { useCheckoutStore } from '../../../core/store/useCheckoutStore';
import { PaymentMethod } from '@selene/types';
import { EmptyState } from '../../ui/EmptyState';
import { BrandIcon } from '../../ui/BrandIcon';

const MAX_CARDS = 3;

type PaymentMethodPickerModalProps = {
  innerRef: React.RefObject<BottomSheetModal | null>;
};

export const PaymentMethodPickerModal = ({
  innerRef,
}: PaymentMethodPickerModalProps) => {
  const theme = useTheme<Theme>();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // Hook de lógica (CRUD y Stripe Config)
  const {
    methods,
    isLoadingMethods,
    getSetupConfig,
    isConfiguring,
    refreshMethods,
  } = usePaymentMethods();
  const { selectedPaymentMethodId, setSelectedPaymentMethodId } =
    useCheckoutStore();

  // Configuración del Sheet (Copiado de AddressPickerModal)
  const snapPoints = useMemo(() => ['60%'], []);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        pressBehavior="close"
      />
    ),
    [],
  );

  // Handler para agregar tarjeta vía Stripe
  const handleAddCard = async () => {
    try {
      const config = await getSetupConfig();

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'Selene Marketplace',
        setupIntentClientSecret: config.setupIntent,
        customerId: config.customer,
        customerEphemeralKeySecret: config.ephemeralKey,
        appearance: {
          colors: { primary: theme.colors.primary },
        },
      });

      if (initError) throw new Error(initError.message);

      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code !== 'Canceled')
          Alert.alert('Error', presentError.message);
        return;
      }

      // Éxito: Esperamos al Webhook y refrescamos
      Alert.alert('Éxito', 'Tarjeta guardada correctamente.');
      setTimeout(() => refreshMethods(), 2000);
    } catch (e: { message?: string }) {
      Alert.alert(
        'Error',
        e.message === 'limit_reached'
          ? 'Límite de 3 tarjetas alcanzado'
          : e.message || 'Error desconocido',
      );
    }
  };

  const handleSelect = (method: PaymentMethod) => {
    setSelectedPaymentMethodId(method.id);
    innerRef.current?.dismiss();
  };

  // Renderizado de Contenido (Tu patrón de ScrollView)
  const renderContent = () => {
    if (isLoadingMethods) {
      return (
        <Box flex={1} justifyContent="center" alignItems="center" padding="xl">
          <ActivityIndicator color={theme.colors.primary} />
        </Box>
      );
    }

    if (!methods || methods.length === 0) {
      return (
        <Box flex={1} justifyContent="center" padding="xl">
          <EmptyState
            icon="credit-card-off-outline"
            title="Sin tarjetas"
            message="Agrega un método de pago para continuar."
          />
        </Box>
      );
    }

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16 }}
      >
        {methods.map((item) => {
          const isSelected = selectedPaymentMethodId === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => handleSelect(item)}
              activeOpacity={0.7}
            >
              <Box
                padding="m"
                borderRadius="m"
                marginBottom="s"
                flexDirection="row"
                alignItems="center"
                backgroundColor="cardBackground"
                borderWidth={1}
                borderColor={isSelected ? 'primary' : 'background'}
              >
                <Box width={40} alignItems="center">
                  <BrandIcon name={item.brand.toLowerCase()} size={24} />
                </Box>

                <Box flex={1} marginLeft="m">
                  <Text variant="body-md" fontWeight="bold">
                    •••• {item.last4}
                  </Text>
                  <Text
                    variant="caption-md"
                    color="textSecondary"
                    style={{ textTransform: 'capitalize' }}
                  >
                    {item.brand} - Exp: {item.exp_month}/{item.exp_year}
                  </Text>
                </Box>

                <MaterialCommunityIcons
                  name={isSelected ? 'radiobox-marked' : 'radiobox-blank'}
                  size={24}
                  color={
                    isSelected
                      ? theme.colors.primary
                      : theme.colors.textSecondary
                  }
                />
              </Box>
            </TouchableOpacity>
          );
        })}

        {methods.length >= MAX_CARDS && (
          <Text
            variant="caption-md"
            textAlign="center"
            color="textSecondary"
            marginTop="m"
          >
            Límite de {MAX_CARDS} tarjetas alcanzado.
          </Text>
        )}
      </ScrollView>
    );
  };

  return (
    <BottomSheetModal
      ref={innerRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose={true}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
      handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
    >
      <BottomSheetView style={{ flex: 1 }}>
        {/* 1. HEADER */}
        <Box
          paddingVertical="m"
          borderBottomWidth={1}
          borderBottomColor="background"
          alignItems="center"
        >
          <Text variant="subheader-md">Mis Métodos de Pago</Text>
        </Box>

        {/* 2. BOTÓN AÑADIR (Fijo arriba como en direcciones) */}
        <TouchableOpacity
          onPress={handleAddCard}
          disabled={isConfiguring || (methods && methods.length >= MAX_CARDS)}
          activeOpacity={0.7}
        >
          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            padding="m"
            borderBottomWidth={1}
            borderBottomColor="background"
            opacity={
              isConfiguring || (methods && methods.length >= MAX_CARDS)
                ? 0.5
                : 1
            }
          >
            {isConfiguring ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <>
                <MaterialCommunityIcons
                  name="plus-circle-outline"
                  size={24}
                  color={theme.colors.primary}
                />
                <Text
                  variant="body-md"
                  color="primary"
                  marginLeft="s"
                  fontWeight="bold"
                >
                  Agregar Nueva Tarjeta
                </Text>
              </>
            )}
          </Box>
        </TouchableOpacity>

        {/* 3. LISTA (Flex 1) */}
        <Box flex={1}>{renderContent()}</Box>
      </BottomSheetView>
    </BottomSheetModal>
  );
};
