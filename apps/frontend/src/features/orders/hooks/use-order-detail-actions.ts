import { useState, useCallback } from 'react';
import { Linking, Share, Clipboard } from 'react-native';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import type { TFunction } from 'i18next';
import type { EnrichedShipment } from '@selene/types';
import type { useOrderActions } from './use-order-actions';

type UseOrderDetailActionsParams = {
  actions: ReturnType<typeof useOrderActions>;
  currentShipment: EnrichedShipment | null;
  isMultiShipment: boolean;
  isSellerCancel: boolean;
  t: TFunction;
};

export function useOrderDetailActions({
  actions,
  currentShipment,
  isMultiShipment,
  isSellerCancel,
  t,
}: UseOrderDetailActionsParams) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeliveryConfirm, setShowDeliveryConfirm] = useState(false);

  const handleConfirmDelivery = async () => {
    if (!currentShipment) {
      setShowDeliveryConfirm(false);
      return;
    }

    try {
      await actions.confirmDelivery.execute({
        shipmentId: currentShipment.id,
      });
      setShowDeliveryConfirm(false);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      Toast.show({
        type: 'success',
        text1: t('orders:dialogs.deliverySuccessTitle'),
        text2: t('orders:dialogs.deliverySuccessMsg'),
      });
    } catch {
      // El hook dispara el toast de error; el diálogo queda abierto para reintentar
    }
  };

  // Only one shipment is cancelled; say so when the order has others.
  const withOtherShipmentsNote = (message: string) =>
    isMultiShipment
      ? `${message} ${t('orders:dialogs.otherShipmentsContinue')}`
      : message;

  const handleCancelOrder = async () => {
    if (!currentShipment) {
      setShowCancelConfirm(false);
      return;
    }

    try {
      await actions.cancelOrder.execute({
        shipmentId: currentShipment.id,
      });
      setShowCancelConfirm(false);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      Toast.show({
        type: 'info',
        text1: t('orders:dialogs.cancelSuccessTitle'),
        text2: withOtherShipmentsNote(
          t(
            isSellerCancel
              ? 'orders:dialogs.cancelSuccessMsgSeller'
              : 'orders:dialogs.cancelSuccessMsgBuyer',
          ),
        ),
      });
    } catch {
      // El hook dispara el toast de error; el diálogo queda abierto para reintentar
    }
  };
  const handleCopyTracking = useCallback((tracking: string) => {
    Clipboard.setString(tracking);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleOpenLabel = async () => {
    if (!currentShipment?.label_url) return;

    try {
      await Linking.openURL(currentShipment.label_url);
    } catch {
      Toast.show({
        type: 'error',
        text1: t('common:errors.generic'),
      });
    }
  };

  const handleShareLabel = async () => {
    if (!currentShipment?.label_url) return;

    try {
      await Share.share({
        title: t('orders:actions.shareTitle'),
        message: t('orders:actions.shareMessage', {
          url: currentShipment.label_url,
        }),
        url: currentShipment.label_url,
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: t('common:errors.generic'),
      });
    }
  };

  const handleTrack = useCallback((url: string) => {
    Linking.openURL(url).catch(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    );
  }, []);

  return {
    showCancelConfirm,
    setShowCancelConfirm,
    showDeliveryConfirm,
    setShowDeliveryConfirm,
    withOtherShipmentsNote,
    handleConfirmDelivery,
    handleCancelOrder,
    handleCopyTracking,
    handleOpenLabel,
    handleShareLabel,
    handleTrack,
  };
}
