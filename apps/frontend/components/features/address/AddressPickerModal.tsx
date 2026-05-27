import React, { useCallback, useMemo, useState } from 'react';
import { TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { AddressCard } from './AddressCard';
import { useAddresses } from '../../../core/hooks/useAddresses';
import { Address } from '@selene/types';
import { EmptyState } from '../../ui/EmptyState';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

const MAX_ADDRESSES = 3;

type AddressPickerModalProps = {
  innerRef: React.RefObject<BottomSheetModal | null>;
  onSelect?: (address: Address) => void;
};

export const AddressPickerModal = React.memo(
  ({ innerRef, onSelect }: AddressPickerModalProps) => {
    const theme = useTheme<Theme>();
    const router = useRouter();
    const { t } = useTranslation(['address', 'common']);

    const {
      addresses,
      isLoading,
      deleteAddress,
      setDefault,
      isSettingDefault,
      isDeleting,
    } = useAddresses();
    const [addressToDelete, setAddressToDelete] = useState<string | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const snapPoints = useMemo(() => ['65%'], []);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const renderBackdrop = useCallback(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (props: any) => (
        <BottomSheetBackdrop
          {...props}
          pressBehavior="close"
        />
      ),
      [],
    );

    // HANDLER UNIFICADO: Al tocar, se vuelve default y se selecciona
    const handleSelect = async (address: Address) => {
      // Si ya es la activa y estamos en checkout, solo cerramos
      if (address.is_default) {
        if (onSelect) onSelect(address);
        innerRef.current?.dismiss();
        return;
      }

      setProcessingId(address.id);
      try {
        // 1. Sincronizamos con la DB (Hacerla principal)
        await setDefault(address.id);

        // 2. Notificamos al Checkout (si aplica)
        if (onSelect) onSelect(address);

        // 3. Cerramos el modal con un pequeño delay para que el usuario vea el cambio
        setTimeout(() => {
          innerRef.current?.dismiss();
        }, 300);
      } finally {
        setProcessingId(null);
      }
    };

    const handleDeleteConfirm = async () => {
      if (addressToDelete) {
        setProcessingId(addressToDelete);
        await deleteAddress(addressToDelete);
        setProcessingId(null);
        setAddressToDelete(null);
      }
    };

    const renderContent = () => {
      if (isLoading && !processingId) {
        return (
          <Box
            flex={1}
            justifyContent="center"
            alignItems="center"
            padding="xl"
          >
            <ActivityIndicator color={theme.colors.primary} />
          </Box>
        );
      }

      if (!addresses || addresses.length === 0) {
        return (
          <Box flex={1} justifyContent="center" padding="xl">
            <EmptyState
              icon="map-marker-off-outline"
              title={t('address:empty.title')}
              message={t('address:empty.message')}
            />
          </Box>
        );
      }

      return (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16 }}
        >
          {addresses.map((item) => {
            const isThisCardProcessing = processingId === item.id;
            return (
              <AddressCard
                key={item.id}
                address={item}
                onPress={() => handleSelect(item)}
                onDelete={(id) => setAddressToDelete(id)}
                isProcessing={isSettingDefault && isThisCardProcessing}
                isDeleting={isDeleting && isThisCardProcessing}
              />
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
        handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
      >
        <BottomSheetView style={{ flex: 1 }}>
          <Box
            paddingVertical="m"
            borderBottomWidth={1}
            borderBottomColor="background"
            alignItems="center"
          >
            <Text variant="subheader-md">{t('address:modal.title')}</Text>
          </Box>

          <TouchableOpacity
            onPress={() => {
              innerRef.current?.dismiss();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              router.push('/address/form' as any);
            }}
            disabled={addresses.length >= MAX_ADDRESSES}
          >
            <Box
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
              padding="m"
              borderBottomWidth={1}
              borderBottomColor="background"
              opacity={addresses.length >= MAX_ADDRESSES ? 0.5 : 1}
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
                {addresses.length >= MAX_ADDRESSES
                  ? t('address:modal.limitReached')
                  : t('address:modal.addBtn')}
              </Text>
            </Box>
          </TouchableOpacity>

          <Box flex={1}>{renderContent()}</Box>
        </BottomSheetView>

        <ConfirmDialog
          visible={!!addressToDelete}
          title={t('address:dialogs.deleteTitle')}
          description={t('address:dialogs.deleteMsg')}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setAddressToDelete(null)}
          isDangerous
          confirmLabel={t('common:dialog.delete')}
          loading={isDeleting}
        />
      </BottomSheetModal>
    );
  },
);
