import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import type { EnrichedShipment } from '@selene/types';

import { Box, Text } from '@/shared/ui/base';
import { PrimaryButton } from '@/shared/ui/button/primary-button';
import { Theme } from '@/shared/theme';
import { canShowSellerLabelActions } from '../logic/shipment-label-visibility';

interface OrderDetailActionsProps {
  shipment: EnrichedShipment;
  isGeneratingLabel: boolean;
  isConfirmingDelivery: boolean;
  isCancelling: boolean;
  onGenerateLabel: () => void;
  onOpenLabel: () => void;
  onShareLabel: () => void;
  onConfirmDelivery: () => void;
  onCancel: () => void;
  onReport: () => void;
}

export function OrderDetailActions({
  shipment,
  isGeneratingLabel,
  isConfirmingDelivery,
  isCancelling,
  onGenerateLabel,
  onOpenLabel,
  onShareLabel,
  onConfirmDelivery,
  onCancel,
  onReport,
}: OrderDetailActionsProps) {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <Box gap="m" marginTop="m">
      {/* El gate de generar guía debe leerse por envío: en una orden
          multi-vendedor, `order.isSeller` es true si el viewer es seller
          de CUALQUIER item, lo que mostraría el botón sobre un envío ajeno. */}
      {shipment.isSeller &&
        shipment.status === 'paid' &&
        !shipment.label_url && (
          <PrimaryButton
            onPress={onGenerateLabel}
            icon="package-variant-closed"
            loading={isGeneratingLabel}
          >
            {t('orders:actions.generateLabel')}
          </PrimaryButton>
        )}
      {/* SECCIÓN DE GUÍA: VER, COMPARTIR Y TIP */}
      {canShowSellerLabelActions({
        isSeller: shipment.isSeller,
        status: shipment.status,
        labelUrl: shipment.label_url,
      }) && (
        <Box gap="s">
          <PrimaryButton onPress={onOpenLabel} icon="printer-check">
            {t('orders:actions.viewPdf')}
          </PrimaryButton>

          <PrimaryButton
            variant="outline"
            onPress={onShareLabel}
            icon="share-variant"
          >
            {t('orders:actions.shareLabel')}
          </PrimaryButton>

          <Text
            variant="caption-md"
            color="textSecondary"
            textAlign="center"
            marginTop="xs"
          >
            {t('orders:actions.printHint')}
          </Text>
        </Box>
      )}
      {shipment.permissions.canConfirmDelivery && (
        <PrimaryButton
          onPress={onConfirmDelivery}
          loading={isConfirmingDelivery}
          icon="check-decagram"
        >
          {t('orders:actions.confirmDelivery')}
        </PrimaryButton>
      )}
      {shipment.permissions.canCancel && (
        <PrimaryButton
          variant="outline"
          onPress={onCancel}
          loading={isCancelling}
          style={{ borderColor: theme.colors.error }}
          labelStyle={{ color: theme.colors.error }}
        >
          {t('orders:actions.cancelOrder')}
        </PrimaryButton>
      )}
      {shipment.permissions.canReport && (
        <TouchableOpacity
          onPress={onReport}
          style={{ alignSelf: 'center', marginTop: 15 }}
        >
          <Text
            variant="caption-lg"
            color="textSecondary"
            style={{ textDecorationLine: 'underline' }}
          >
            {t('orders:actions.reportProblem')}
          </Text>
        </TouchableOpacity>
      )}
    </Box>
  );
}
