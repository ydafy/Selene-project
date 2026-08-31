/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { ShippingLabelCard } from './ShippingLabelCard';
import { EnrichedOrder, EnrichedShipment } from '@selene/types';
import { useOrderCountdown } from '@/core/hooks/useOrderCountdown';
import { useCancellationSettings } from '@/core/hooks/useCancellationSettings';
import { resolveShipmentPreparingWindowMessage } from '@/core/utils/shipment-cancel-safety';
import { Theme } from '@/core/theme';

interface Props {
  order: EnrichedOrder;
  shipment: EnrichedShipment;
  returnPayment: any;
  onRefresh: () => void;
  shareLabel: (url: string, id: string) => void;
  isSharing: boolean;
}

export const OrderActionCard = ({
  order,
  shipment,
  returnPayment,
  onRefresh,
  shareLabel,
  isSharing,
}: Props) => {
  const { t } = useTranslation(['orders']);
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { permissions, dispute, isSeller, isBuyer } = shipment;
  const { orderExpirationHours, preparingExpirationHours } =
    useCancellationSettings();

  // --- 1. LÓGICA DEL RELOJ DINÁMICO ---
  const timerConfig = useMemo(() => {
    if (permissions.canCancel && shipment.created_at) {
      return {
        startTime: shipment.created_at,
        limit: orderExpirationHours,
      };
    }

    if (shipment.status === 'preparing' && shipment.updated_at) {
      return {
        startTime: shipment.updated_at,
        limit: preparingExpirationHours,
      };
    }

    // Escenario A: Esperando liberación normal.
    // La ventana de revisión de 48h arranca cuando ESTE envío se entrega
    // (shipment.delivered_at), no cuando la orden completa se entrega — en
    // órdenes multi-vendedor, order.delivered_at se setea con el último envío
    // y adelantaría/retrasaría el countdown de cada vendedor.
    if (permissions.showSellerDeliveredBanner && shipment.delivered_at) {
      return { startTime: shipment.delivered_at, limit: 48 };
    }
    // Escenario B: Esperando pago de retorno
    if (
      dispute?.status === 'waiting_return' &&
      dispute.return_payout_status === 'pending'
    ) {
      return { startTime: dispute.updated_at, limit: 48 };
    }
    // Escenario C: Esperando envío de retorno
    if (
      dispute?.status === 'waiting_return' &&
      dispute.return_payout_status === 'paid' &&
      !dispute.return_tracking_number
    ) {
      return { startTime: dispute.updated_at, limit: 48 };
    }
    return null;
  }, [
    shipment,
    dispute,
    permissions,
    orderExpirationHours,
    preparingExpirationHours,
  ]);

  const { timeLeft, isExpired } = useOrderCountdown(
    timerConfig?.startTime,
    timerConfig?.limit,
  );

  // --- 2. DETERMINAR SI DEBEMOS MOSTRAR EL BANNER ---
  const isCriticalStatus = order.status
    ? ['cancelled', 'dispute', 'refunded'].includes(order.status)
    : false;
  const shouldShow =
    isCriticalStatus ||
    permissions.showSellerDeliveredBanner ||
    permissions.canCancel ||
    shipment.status === 'preparing';

  if (!shouldShow) return null;

  // --- 3. CONFIGURACIÓN VISUAL ---
  const isWaitingReturn = dispute?.status === 'waiting_return';
  const isManualCancelWindow = permissions.canCancel || shipment.status === 'preparing';
  const bannerColor =
    isManualCancelWindow || isWaitingReturn || permissions.showSellerDeliveredBanner
      ? theme.colors.primary
      : theme.colors.error;
  const bannerBorderColor = isManualCancelWindow
    ? 'primary'
    : isWaitingReturn
      ? 'error'
      : permissions.showSellerDeliveredBanner
        ? 'success'
        : 'error';
  const iconName = isWaitingReturn
    ? 'truck-delivery'
    : isManualCancelWindow
      ? 'clock-alert-outline'
    : permissions.showSellerDeliveredBanner
      ? 'clock-check'
      : 'alert-octagon';

  const getBannerTitle = () => {
    if (permissions.canCancel) return t('actionCard.cancellationWindowTitle');
    if (shipment.status === 'preparing') return t('actionCard.preparingShipmentTitle');
    if (permissions.showSellerDeliveredBanner) return t('actionCard.deliveredTitle');
    if (order.status === 'dispute') {
      if (dispute?.status === 'return_delivered' && isSeller)
        return t('actionCard.recordUnboxingTitle');
      return t('orders:detail.returnTitle');
    }
    return t(`orders:status.${order.status}`).toUpperCase();
  };

  // --- 4. MENSAJES DINÁMICOS (CON RELOJ) ---
  const getBannerMessage = () => {
    if (permissions.canCancel) {
      return isExpired
        ? t('actionCard.cancellationWindowClosed')
        : t('actionCard.cancellationWindowOpen', { timeLeft });
    }

    if (shipment.status === 'preparing') {
      return isExpired
        ? isSeller
          ? t('actionCard.carrierScanWindowClosed')
          : t('actionCard.sellerShippingWindowClosed')
        : resolveShipmentPreparingWindowMessage({
            isBuyer,
            isSeller,
            timeLeft,
          });
    }

    if (permissions.showSellerDeliveredBanner) {
      return isExpired
        ? t('actionCard.reviewWindowClosed')
        : t('actionCard.fundsReleaseCountdown', { timeLeft });
    }

    if (order.status === 'dispute') {
      if (dispute?.status === 'open') {
        return isBuyer
          ? t('orders:detail.disputeMsgBuyer')
          : t('orders:detail.disputeMsgSeller');
      }

      if (dispute?.status === 'waiting_return') {
        if (dispute.return_payout_status === 'pending') {
          return isBuyer
            ? t('actionCard.returnPayoutPendingBuyer', { timeLeft })
            : t('actionCard.returnPayoutPendingSeller', { timeLeft });
        }
        if (!dispute.return_label_url) {
          return isBuyer
            ? t('actionCard.returnLabelPendingBuyer', { timeLeft })
            : t('actionCard.returnLabelPendingSeller', { timeLeft });
        }
        return isBuyer
          ? t('actionCard.returnShipmentPendingBuyer', { timeLeft })
          : t('actionCard.returnShipmentPendingSeller', { timeLeft });
      }

      if (dispute?.status === 'return_shipped')
        return t('actionCard.returnShipmentInTransit');
      if (dispute?.status === 'return_delivered') {
        return isSeller
          ? t('orders:detail.videoWarningMsg')
          : t('actionCard.returnDeliveredBuyer');
      }
    }

    if (order.status === 'refunded') {
      return isBuyer
        ? t('actionCard.refundProcessedBuyer')
        : t('actionCard.refundProcessedSeller');
    }
    return t(`orders:detail.${order.status}Msg`);
  };

  return (
    <MotiView
      from={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
        <Box
          backgroundColor="warning"
          padding="m"
          borderRadius="l"
          borderWidth={1}
          borderColor={bannerBorderColor}
          marginBottom="m"
        >
        <Box
          flexDirection="row"
          alignItems="center"
          gap="m"
          marginBottom={
            permissions.canPayReturn ||
            permissions.canUploadReturnEvidence
              ? 'm'
              : undefined
          }
        >
          <MaterialCommunityIcons
            name={iconName as any}
            size={24}
            color={bannerColor}
          />
          <Box flex={1}>
            <Text
              variant="body-md"
              fontWeight="bold"
              color={
                isWaitingReturn || permissions.showSellerDeliveredBanner
                  ? 'primary'
                  : 'error'
              }
            >
              {getBannerTitle()}
            </Text>
            <Text variant="caption-md" color="textPrimary">
              {getBannerMessage()}
            </Text>
          </Box>
        </Box>

        {/* --- 5. ACCIONES --- */}
        <Box gap="s">
          {isSeller && permissions.canPayReturn && (
            <PrimaryButton
              onPress={async () => {
                await returnPayment.handleReturnPayment();
                onRefresh();
              }}
              loading={returnPayment.loading}
              disabled={isExpired}
              icon="credit-card-check"
            >
              {t('orders:actions.payReturnLabel')}
            </PrimaryButton>
          )}

          {isBuyer && permissions.canUploadReturnEvidence && (
            <PrimaryButton
              onPress={() =>
                router.push(`/profile/orders/return/${order.id}` as any)
              }
              disabled={isExpired}
              icon="camera"
            >
              {t('orders:actions.prepareReturnLabel')}
            </PrimaryButton>
          )}

          {/* EL VENDEDOR IMPUGNA EL RETORNO */}
          {isSeller && dispute?.status === 'return_delivered' && (
            <PrimaryButton
              variant="outline"
              onPress={() =>
                router.push(`/profile/orders/report/${order.id}` as any)
              }
              icon="shield-alert"
              style={{ borderColor: theme.colors.error, marginTop: 8 }}
              labelStyle={{ color: theme.colors.error }}
            >
              {t('actionCard.reportReturnProblem')}
            </PrimaryButton>
          )}
        </Box>
      </Box>

      {/* --- 6. GUÍA --- */}
      {dispute?.return_label_url && (
        <Box marginBottom="m">
          <ShippingLabelCard
            labelUrl={dispute.return_label_url}
            orderId={order.id}
            onShare={shareLabel}
            isLoading={isSharing}
          />
        </Box>
      )}
    </MotiView>
  );
};
