/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState } from 'react';
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
import { ErrorState } from '../../ui/ErrorState'; // Importado
import { BrandIcon } from '../../ui/BrandIcon';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

const MAX_CARDS = 3;

export const PaymentMethodPickerModal = ({
  innerRef,
}: {
  innerRef: React.RefObject<BottomSheetModal | null>;
}) => {
  const theme = useTheme<Theme>();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [isSyncing, setIsSyncing] = useState(false);
  const [methodToDelete, setMethodToDelete] = useState<PaymentMethod | null>(
    null,
  );

  const {
    methods,
    isLoadingMethods,
    listError, // Detectamos error de carga
    getSetupConfig,
    isConfiguring,
    refreshMethods,
    deleteMethod,
    isDeleting,
  } = usePaymentMethods();

  const { selectedPaymentMethodId, setSelectedPaymentMethodId } =
    useCheckoutStore();

  const snapPoints = useMemo(() => ['65%'], []);

  const handleAddCard = async () => {
    try {
      const currentCount = methods.length;
      const config = await getSetupConfig();

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'Selene Marketplace',
        setupIntentClientSecret: config.setupIntent,
        customerId: config.customer,
        customerEphemeralKeySecret: config.ephemeralKey,
        // --- PERSONALIZACIÓN DE DISEÑO ---
        appearance: {
          shapes: {
            borderRadius: 12, // Coincide con tus cardStyles
            borderWidth: 1,
          },
          colors: {
            primary: theme.colors.primary,
            background: theme.colors.cardBackground,
            componentBackground: theme.colors.background,
            primaryText: theme.colors.textPrimary,
            secondaryText: theme.colors.textPrimary,
            componentText: theme.colors.textPrimary,
            placeholderText: theme.colors.textSecondary,
            icon: theme.colors.primary,
            error: theme.colors.error,
          },
        },
        // Opcional: Habilitar Google Pay si lo configuraste en app.json
        googlePay: {
          merchantCountryCode: 'MX',
          testEnv: true, // Cambiar a false en producción
        },
      });

      if (initError) throw new Error(initError.message);
      const { error: presentError } = await presentPaymentSheet();
      if (presentError) return;

      // Sincronización optimista
      setIsSyncing(true);
      setTimeout(async () => {
        const { data } = await refreshMethods();
        if (data && data.length > currentCount) {
          setSelectedPaymentMethodId(data[0].id);
        }
        setIsSyncing(false);
      }, 2500);
    } catch (e: any) {
      Alert.alert(
        'Error',
        e.message === 'limit_reached' ? 'Límite alcanzado' : e.message,
      );
    }
  };

  const handleDelete = async () => {
    if (!methodToDelete) return;
    try {
      // FIX: Si borramos la seleccionada, limpiamos el store antes del borrado físico
      if (selectedPaymentMethodId === methodToDelete.id) {
        setSelectedPaymentMethodId(null);
      }

      await deleteMethod(methodToDelete.id);
      setMethodToDelete(null);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e: any) {
      Alert.alert('Error', 'No se pudo eliminar la tarjeta.');
    }
  };

  const renderContent = () => {
    // 1. Estado de Carga
    if (isLoadingMethods && !isSyncing) {
      return (
        <Box flex={1} justifyContent="center" alignItems="center" padding="xl">
          <ActivityIndicator color={theme.colors.primary} />
        </Box>
      );
    }

    // 2. Estado de Error (Uso de ErrorState)
    if (listError) {
      return (
        <ErrorState
          onRetry={() => refreshMethods()}
          message="No pudimos cargar tus tarjetas. Revisa tu conexión."
        />
      );
    }

    // 3. Estado Vacío
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

    // 4. Lista de Tarjetas
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16 }}
      >
        {methods.map((item) => {
          const isSelected = selectedPaymentMethodId === item.id;
          return (
            <Box
              key={item.id}
              flexDirection="row"
              alignItems="center"
              marginBottom="s"
              backgroundColor="cardBackground"
              borderRadius="m"
              borderWidth={1}
              borderColor={isSelected ? 'primary' : 'separator'}
              overflow="hidden" // Para que el ripple de selección respete los bordes
            >
              <TouchableOpacity
                onPress={() => {
                  setSelectedPaymentMethodId(item.id);
                  innerRef.current?.dismiss();
                }}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 16,
                }}
                activeOpacity={0.6}
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
                    {item.brand} - {item.exp_month}/{item.exp_year}
                  </Text>
                </Box>
                <MaterialCommunityIcons
                  name={isSelected ? 'radiobox-marked' : 'radiobox-blank'}
                  size={22}
                  color={
                    isSelected
                      ? theme.colors.primary
                      : theme.colors.textSecondary
                  }
                />
              </TouchableOpacity>

              {/* BOTÓN ELIMINAR INTEGRADO */}
              <Box
                width={1}
                height="60%"
                backgroundColor="separator"
                opacity={0.5}
              />
              <TouchableOpacity
                onPress={() => setMethodToDelete(item)}
                style={{ paddingHorizontal: 16, paddingVertical: 20 }}
                hitSlop={{ top: 10, bottom: 10, left: 5, right: 10 }}
              >
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={22}
                  color={theme.colors.error}
                />
              </TouchableOpacity>
            </Box>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <BottomSheetModal
      ref={innerRef}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={(props) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          pressBehavior="close"
        />
      )}
      backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
    >
      <BottomSheetView style={{ flex: 1 }}>
        <Box
          paddingVertical="m"
          borderBottomWidth={1}
          borderBottomColor="background"
          alignItems="center"
        >
          <Text variant="subheader-md">Mis Métodos de Pago</Text>
        </Box>

        <TouchableOpacity
          onPress={handleAddCard}
          disabled={isConfiguring || isSyncing || methods.length >= MAX_CARDS}
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
              isConfiguring || isSyncing || methods.length >= MAX_CARDS
                ? 0.5
                : 1
            }
          >
            {isConfiguring || isSyncing ? (
              <Box flexDirection="row" alignItems="center">
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text
                  variant="body-md"
                  color="primary"
                  marginLeft="s"
                  fontWeight="bold"
                >
                  {isSyncing
                    ? 'Verificando tarjeta...'
                    : 'Conectando con Stripe...'}
                </Text>
              </Box>
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

        <Box flex={1}>{renderContent()}</Box>

        <ConfirmDialog
          visible={!!methodToDelete}
          title="Eliminar tarjeta"
          description={`¿Estás seguro de que quieres eliminar la tarjeta terminada en ${methodToDelete?.last4}?`}
          icon="alert-circle-outline"
          isDangerous
          confirmLabel="Eliminar"
          loading={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => setMethodToDelete(null)}
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
};
