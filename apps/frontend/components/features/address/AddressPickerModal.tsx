import React, { useCallback, useMemo } from 'react';
import { TouchableOpacity, ScrollView } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { AddressCard } from './AddressCard'; // Tu tarjeta bonita
import { useAddresses } from '../../../core/hooks/useAddresses'; // Tu hook CRUD
import { useCheckoutStore } from '../../../core/store/useCheckoutStore';
import { Address } from '@selene/types';
import { EmptyState } from '../../ui/EmptyState';

const MAX_ADDRESSES = 5;

type AddressPickerModalProps = {
  innerRef: React.RefObject<BottomSheetModal | null>;
  onSelect?: (address: Address) => void; // Opcional, si queremos seleccionar para checkout
};

export const AddressPickerModal = ({
  innerRef,
  onSelect,
}: AddressPickerModalProps) => {
  const theme = useTheme<Theme>();
  const router = useRouter();

  // Hook de lógica (CRUD)
  const { addresses, isLoading, deleteAddress, setDefault } = useAddresses();
  const { selectedAddress } = useCheckoutStore();

  // Configuración del Sheet (Tu estructura probada)
  const snapPoints = useMemo(() => ['65%'], []);

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

  // Handlers
  const handleAddAddress = () => {
    innerRef.current?.dismiss();
    router.push({ pathname: '/address/form' as never }); // Navegamos a la pantalla completa
  };

  const handleSelect = (address: Address) => {
    if (onSelect) {
      onSelect(address);
      innerRef.current?.dismiss();
    } else {
      // Si no es modo selección, quizás lo hacemos default
      setDefault(address.id);
    }
  };

  // Renderizado de Contenido (Tu patrón)
  const renderContent = () => {
    if (isLoading) {
      return (
        <Box flex={1} justifyContent="center" alignItems="center">
          <Text>Cargando...</Text>
        </Box>
      );
    }

    if (!addresses || addresses.length === 0) {
      return (
        <Box flex={1} justifyContent="center" padding="xl">
          <EmptyState
            icon="map-marker-off-outline"
            title="Sin direcciones"
            message="Agrega una dirección para tus envíos."
          />
        </Box>
      );
    }

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16 }}
      >
        {addresses.map((item) => (
          <AddressCard
            key={item.id}
            address={item}
            onPress={() => handleSelect(item)}
            // Si estamos en modo selección (checkout), quizás ocultamos borrar/default
            // Pero para el Header Global, queremos gestión completa:
            onDelete={deleteAddress}
            onSetDefault={setDefault}
            // Comparamos con selectedAddress del checkout store si estamos en modo selección
            isSelected={
              // Si hay onSelect (modo checkout), usa selectedAddress
              // Si no hay onSelect (modo gestión), usa is_default
              onSelect ? selectedAddress?.id === item.id : item.is_default
            }
          />
        ))}

        {addresses.length >= MAX_ADDRESSES && (
          <Text
            variant="caption-md"
            textAlign="center"
            color="textSecondary"
            marginTop="m"
          >
            Límite de {MAX_ADDRESSES} direcciones alcanzado.
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
      {/* Tu estructura: BottomSheetView con Flex 1 */}
      <BottomSheetView style={{ flex: 1 }}>
        {/* 1. HEADER */}
        <Box
          paddingVertical="m"
          borderBottomWidth={1}
          borderBottomColor="background"
          alignItems="center"
        >
          <Text variant="subheader-md">Mis Direcciones</Text>
        </Box>

        {/* 2. BOTÓN AÑADIR (Fijo arriba) */}
        <TouchableOpacity
          onPress={handleAddAddress}
          disabled={addresses && addresses.length >= MAX_ADDRESSES}
          activeOpacity={0.7}
        >
          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            padding="m"
            borderBottomWidth={1}
            borderBottomColor="background"
            opacity={addresses && addresses.length >= MAX_ADDRESSES ? 0.5 : 1}
          >
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
              Agregar Nueva Dirección
            </Text>
          </Box>
        </TouchableOpacity>

        {/* 3. LISTA (Flex 1) */}
        <Box flex={1}>{renderContent()}</Box>
      </BottomSheetView>
    </BottomSheetModal>
  );
};
