import React, { useMemo, useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { SellerPaymentExplanation } from '../payments/SellerPaymentExplanation';
import { ShippingLabelCard } from './ShippingLabelCard';
import { EnrichedOrder, EnrichedShipment } from '@selene/types';
import { useOrderCountdown } from '@/core/hooks/useOrderCountdown';
import { useCancellationSettings } from '@/core/hooks/useCancellationSettings';
import { useShipmentCancellationSummary } from '@/core/hooks/useShipmentCancellationSummary';
import { resolveShipmentPreparingWindowMessage } from '@/core/utils/shipment-cancel-safety';
import { resolveCancelledShipmentCopy } from '@/core/utils/shipment-cancellation-summary';
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
  const { t } = useTranslation(['orders', 'sellerOnboarding']);
  const { height } = useWindowDimensions();
  const [isPaymentExplanationVisible, setIsPaymentExplanationVisible] = useState(false);
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { permissions, dispute, isSeller, isBuyer } = shipment;
  // Raw fallback shipments can inherit order-level permissions; scope this
  // presentation hint to the selected shipment before showing review UI.
  const showSellerDeliveredBanner =
    permissions.showSellerDeliveredBanner &&
    isSeller &&
    shipment.status === 'delivered' &&
    !dispute;
  const showBuyerDeliveredBanner =
    isBuyer && shipment.status === 'delivered' && !dispute;
  const showDeliveredReviewBanner =
    showSellerDeliveredBanner || showBuyerDeliveredBanner;
  const showSellerCompletedBanner =
    isSeller && shipment.status === 'completed' && !dispute;
  const showSellerStatusBanner =
    showSellerDeliveredBanner || showSellerCompletedBanner;
  const showStatusBanner = showSellerStatusBanner || showBuyerDeliveredBanner;
  const { orderExpirationHours, preparingExpirationHours } =
    useCancellationSettings();
  const cancellationSummary = useShipmentCancellationSummary(shipment.id, shipment.status);

  // --- 1. LÓGICA DEL RELOJ DINÁMICO ---
  const timerConfig = useMemo(() => {
    if (
      permissions.canCancel &&
      shipment.created_at &&
      orderExpirationHours != null
    ) {
      return {
        startTime: shipment.created_at,
        limit: orderExpirationHours,
      };
    }

    if (
      shipment.status === 'preparing' &&
      shipment.updated_at &&
      preparingExpirationHours != null
    ) {
      return {
        startTime: shipment.updated_at,
        limit: preparingExpirationHours,
      };
    }

    // Each shipment owns its buyer review deadline, not the whole order.
    if (
      showDeliveredReviewBanner &&
      shipment.delivered_at &&
      Number.isFinite(new Date(shipment.delivered_at).getTime())
    ) {
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
    showDeliveredReviewBanner,
  ]);

  const { timeLeft, isExpired } = useOrderCountdown(
    timerConfig?.startTime,
    timerConfig?.limit,
  );

  // --- 2. DETERMINAR SI DEBEMOS MOSTRAR EL BANNER ---
  const isCriticalStatus = order.status
    ? ['cancelled', 'dispute', 'refunded'].includes(order.status)
    : false;
  // A multi-seller order stays active when only this shipment is cancelled.
  const isCancelledShipment = shipment.status === 'cancelled' && order.status !== 'dispute';
  const shouldShow =
    isCriticalStatus ||
    isCancelledShipment ||
    showSellerStatusBanner ||
    showBuyerDeliveredBanner ||
    permissions.canCancel ||
    shipment.status === 'preparing';

  if (!shouldShow) return null;

  // --- 3. CONFIGURACIÓN VISUAL ---
  const isWaitingReturn = dispute?.status === 'waiting_return';
  const isManualCancelWindow =
    permissions.canCancel || shipment.status === 'preparing';
  const bannerColor =
    isManualCancelWindow ||
    isWaitingReturn ||
    showStatusBanner
      ? theme.colors.primary
      : theme.colors.error;
  const bannerBorderColor = isManualCancelWindow
    ? 'primary'
    : isWaitingReturn
      ? 'error'
      : showStatusBanner
        ? 'success'
        : 'error';
  const iconName = isWaitingReturn
    ? 'truck-delivery'
    : isManualCancelWindow
      ? 'clock-alert-outline'
      : showStatusBanner
        ? 'clock-check'
        : 'alert-octagon';

  const getBannerTitle = () => {
    if (permissions.canCancel) return t('actionCard.cancellationWindowTitle');
    if (shipment.status === 'preparing')
      return t('actionCard.preparingShipmentTitle');
    if (showSellerDeliveredBanner) return t('actionCard.deliveredTitle');
    if (showBuyerDeliveredBanner)
      return isExpired
        ? t('actionCard.deliveredTitle')
        : t('actionCard.buyerDeliveredTitle');
    if (showSellerCompletedBanner) return t('orders:status.completed');
    if (isCancelledShipment) return t('orders:status.cancelled').toUpperCase();
    if (order.status === 'dispute') {
      if (dispute?.status === 'return_delivered' && isSeller)
        return t('actionCard.recordUnboxingTitle');
      if (dispute?.status === 'open')
        return t('orders:card.disputeStatus.open').toUpperCase();
      return t('orders:detail.returnTitle');
    }
    return t(`orders:status.${order.status}`).toUpperCase();
  };

  const cancelledCopy = resolveCancelledShipmentCopy(
    cancellationSummary,
    isBuyer,
    Boolean(shipment.label_url),
  );

  // --- 4. MENSAJES DINÁMICOS (CON RELOJ) ---
  const getBannerMessage = () => {
    // Settings still loading or missing: the backend has no deadline either,
    // so say nothing about time instead of showing a placeholder countdown.
    if (
      (permissions.canCancel && orderExpirationHours == null) ||
      (shipment.status === 'preparing' && preparingExpirationHours == null)
    ) {
      return null;
    }

    if (permissions.canCancel) {
      // Past the deadline the shipment stays `paid` (and cancellable) until the cron cancels it.
      return isExpired
        ? isBuyer
          ? t('actionCard.cancellationWindowExpiredBuyer')
          : t('actionCard.cancellationWindowExpiredSeller')
        : t('actionCard.cancellationWindowOpen', { timeLeft });
    }

    if (shipment.status === 'preparing') {
      const preparingMessage = resolveShipmentPreparingWindowMessage({
        isBuyer,
        isSeller,
        timeLeft,
        isExpired,
      });
      return t(preparingMessage.key, preparingMessage.params);
    }

    if (showDeliveredReviewBanner && isExpired) {
      return t('actionCard.reviewWindowClosed');
    }
    if (showSellerDeliveredBanner) {
      return t('actionCard.deliveredReviewMessage');
    }
    if (showBuyerDeliveredBanner) {
      return t('actionCard.buyerDeliveredMessage');
    }
    if (showSellerCompletedBanner) {
      return t('actionCard.completedMessage');
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
    if (isCancelledShipment) {
      return t(cancelledCopy.messageKey);
    }
    return t(`orders:detail.${order.status}Msg`);
  };

  return (
    <MotiView
      from={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <Box
        backgroundColor="errorSubtle"
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
            permissions.canPayReturn || permissions.canUploadReturnEvidence
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
                isWaitingReturn || showStatusBanner
                  ? 'primary'
                  : 'error'
              }
            >
              {getBannerTitle()}
            </Text>
            {showDeliveredReviewBanner && timerConfig && !isExpired && (
              <Text
                variant="caption-md"
                color="textPrimary"
                fontWeight="bold"
                marginTop="s"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {showSellerDeliveredBanner
                  ? t('actionCard.sellerReviewCountdown', { timeLeft })
                  : t('actionCard.buyerReviewCountdown', { timeLeft })}
              </Text>
            )}
            {isCancelledShipment && cancelledCopy.reasonKey && (
              <Text
                variant="caption-md"
                color="textPrimary"
                fontWeight="bold"
                marginTop="s"
              >
                {t(cancelledCopy.reasonKey)}
              </Text>
            )}
            <Text
              variant="caption-md"
              color="textPrimary"
              marginTop={showDeliveredReviewBanner ? 's' : undefined}
            >
              {getBannerMessage()}
            </Text>
            {isCancelledShipment && cancelledCopy.labelNoticeKey && (
              <Text
                variant="caption-md"
                color="textPrimary"
                fontWeight="bold"
                marginTop="s"
              >
                {t(cancelledCopy.labelNoticeKey)}
              </Text>
            )}
          </Box>
        </Box>

        {/* --- 5. ACCIONES --- */}
        <Box gap="s">
          {showSellerStatusBanner && (
            <PrimaryButton
              variant="outline"
              icon="help-circle-outline"
              style={{ marginTop: theme.spacing.m }}
              onPress={() => setIsPaymentExplanationVisible(true)}
            >
              {t('actionCard.paymentExplanationHelp')}
            </PrimaryButton>
          )}
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
                router.push(`/profile/orders/report/${order.id}?shipment_id=${shipment.id}` as any)
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

      <ConfirmDialog
        visible={showSellerStatusBanner && isPaymentExplanationVisible}
        title={t('sellerOnboarding:paymentExplanation.title')}
        onConfirm={() => setIsPaymentExplanationVisible(false)}
        onCancel={() => setIsPaymentExplanationVisible(false)}
        confirmLabel={t('actionCard.paymentExplanationClose')}
        hideCancel
      >
        <ScrollView
          style={{ maxHeight: height * 0.45 }}
          contentContainerStyle={{ paddingBottom: theme.spacing.s }}
        >
          <SellerPaymentExplanation />
        </ScrollView>
      </ConfirmDialog>

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
