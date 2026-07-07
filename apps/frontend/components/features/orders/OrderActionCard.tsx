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
import { useOrderActions } from '@/core/hooks/useOrderActions';
import { useOrderCountdown } from '@/core/hooks/useOrderCountdown';
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
  const actions = useOrderActions(order.id);

  // --- 1. LÓGICA DEL RELOJ DINÁMICO ---
  const timerConfig = useMemo(() => {
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
  }, [shipment, dispute, permissions]);

  const { timeLeft, isExpired } = useOrderCountdown(
    timerConfig?.startTime,
    timerConfig?.limit,
  );

  // --- 2. DETERMINAR SI DEBEMOS MOSTRAR EL BANNER ---
  const isCriticalStatus = order.status
    ? ['cancelled', 'dispute', 'refunded'].includes(order.status)
    : false;
  const shouldShow = isCriticalStatus || permissions.showSellerDeliveredBanner;

  if (!shouldShow) return null;

  // --- 3. CONFIGURACIÓN VISUAL ---
  const isWaitingReturn = dispute?.status === 'waiting_return';
  const bannerColor =
    isWaitingReturn || permissions.showSellerDeliveredBanner
      ? theme.colors.primary
      : theme.colors.error;
  const iconName = isWaitingReturn
    ? 'truck-delivery'
    : permissions.showSellerDeliveredBanner
      ? 'clock-check'
      : 'alert-octagon';

  const getBannerTitle = () => {
    if (permissions.showSellerDeliveredBanner) return 'ENTREGA CONFIRMADA';
    if (order.status === 'dispute') {
      if (dispute?.status === 'return_delivered' && isSeller)
        return 'GRABA TU UNBOXING';
      return t('orders:detail.returnTitle');
    }
    return t(`orders:status.${order.status}`).toUpperCase();
  };

  // --- 4. MENSAJES DINÁMICOS (CON RELOJ) ---
  const getBannerMessage = () => {
    if (permissions.showSellerDeliveredBanner) {
      return isExpired
        ? 'El tiempo de revisión ha terminado. Tus fondos se están procesando.'
        : `El paquete ha llegado. Tus fondos se liberarán en: ${timeLeft}`;
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
            ? `Veredicto a tu favor. El vendedor tiene ${timeLeft} para pagar la guía o ganarás el caso automáticamente.`
            : `Debes pagar la guía de retorno en ${timeLeft} para recuperar tu producto o perderás el caso.`;
        }
        if (!dispute.return_label_url) {
          return isBuyer
            ? `¡Pago confirmado! Tienes ${timeLeft} para generar tu guía y enviar el paquete.`
            : `Pago confirmado. El comprador tiene ${timeLeft} para generar la guía y enviar el paquete.`;
        }
        return isBuyer
          ? `Guía lista. Tienes ${timeLeft} para entregar el paquete en la sucursal o perderás el caso.`
          : `Guía generada. El comprador tiene ${timeLeft} para enviar el paquete.`;
      }

      if (dispute?.status === 'return_shipped')
        return 'El paquete de retorno ya está con la paquetería.';
      if (dispute?.status === 'return_delivered') {
        return isSeller
          ? t('orders:detail.videoWarningMsg')
          : 'El vendedor ya recibió el paquete. Tu reembolso se procesará tras la inspección.';
      }
    }

    if (order.status === 'refunded') {
      return isBuyer
        ? 'Tu reembolso ha sido procesado con éxito. El dinero se verá reflejado en tu cuenta en un plazo de 5 a 10 días hábiles.'
        : 'Disputa cerrada. El dinero ha sido devuelto al comprador.';
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
        borderColor={
          isWaitingReturn
            ? 'error'
            : permissions.showSellerDeliveredBanner
              ? 'success'
              : 'error'
        }
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
              Reportar Problema con el Retorno
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
