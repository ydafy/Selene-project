/**
 * @file components/features/orders/OrderShipmentCard.tsx
 * @description Compact per-shipment card for multi-seller order summaries.
 * Displays seller info, items, tracking, actions, and total for one EnrichedShipment.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { EnrichedShipment } from '@selene/types';
import { Theme } from '@/core/theme';
import { formatCurrency } from '@/core/utils/format';
import {
  getOrderStatusColor,
  getOrderStatusLabel,
} from '@/core/utils/order-status';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderShipmentCardProps {
  shipment: EnrichedShipment;
  orderId: string;
  onPress?: (shipmentId: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AVATAR_SIZE = 36;
const THUMBNAIL_SIZE = 48;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const OrderShipmentCard = ({
  shipment,
  orderId,
  onPress,
}: OrderShipmentCardProps) => {
  // orderId is kept on the interface for parent context but not used directly
  void orderId;

  const theme = useTheme<Theme>();
  const { t } = useTranslation(['orders', 'common']);

  // --- Derived data ---
  const statusColorKey = getOrderStatusColor(shipment.status);
  const statusColor = theme.colors[statusColorKey] as string;
  const statusLabel = t(getOrderStatusLabel(shipment.status));

  const item = shipment.items[0];
  const totalAmount = shipment.items.reduce(
    (sum, shipmentItem) => sum + Number(shipmentItem.price_at_purchase),
    0,
  );

  const carrierName = shipment.carrier
    ? shipment.carrier.charAt(0).toUpperCase() + shipment.carrier.slice(1)
    : 'Paquetexpress';

  const [failedAvatarUrl, setFailedAvatarUrl] = React.useState<string | null>(
    null,
  );

  // Whether the card has interactive content (always true — manage button)
  const hasManageOption = true;

  // Pre-compute status line so we only render it once
  const statusLineContent = (() => {
    if (shipment.dispute) {
      const disputeStatus = shipment.dispute.status ?? 'open';
      const disputeLabel = t(`card.disputeStatus.${disputeStatus}`);
      return (
        <Box flexDirection="row" alignItems="center">
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={16}
            color={theme.colors.error}
          />
          <Text
            variant="caption-md"
            color="error"
            marginLeft="xs"
            fontWeight="bold"
          >
            {disputeLabel}
          </Text>
        </Box>
      );
    }

    if (shipment.tracking_number) {
      return (
        <Box flexDirection="row" alignItems="center">
          <MaterialCommunityIcons
            name="package-variant-closed"
            size={16}
            color={theme.colors.textSecondary}
          />
          <Text
            variant="caption-md"
            marginLeft="xs"
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {carrierName} • {shipment.tracking_number}
          </Text>
          <Text variant="caption-md" color="primary" fontWeight="bold">
            {t('actions.trackOrder')}
          </Text>
        </Box>
      );
    }

    return null;
  })();

  // --- Render helpers ---

  const renderAvatar = () => {
    const avatarUrl = shipment.seller?.avatar_url?.trim();
    const firstLetter = shipment.seller?.username?.charAt(0).toUpperCase();
    const hasAvatar = !!avatarUrl && failedAvatarUrl !== avatarUrl;

    return (
      <Box
        width={AVATAR_SIZE}
        height={AVATAR_SIZE}
        borderRadius="full"
        backgroundColor="primary"
        justifyContent="center"
        alignItems="center"
        marginRight="s"
        overflow="hidden"
      >
        {hasAvatar ? (
          <AppImage
            source={{ uri: avatarUrl }}
            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            contentFit="cover"
            onError={() => setFailedAvatarUrl(avatarUrl ?? null)}
          />
        ) : firstLetter ? (
          <Text variant="body-md" color="background" fontWeight="bold">
            {firstLetter}
          </Text>
        ) : (
          <MaterialCommunityIcons
            name="account"
            size={20}
            color={theme.colors.background}
          />
        )}
      </Box>
    );
  };

  const renderStatusBadge = () => (
    <Box
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        borderColor: statusColor,
        borderWidth: 1,
        alignSelf: 'flex-start',
        flexShrink: 0,
      }}
      paddingHorizontal="s"
      paddingVertical="xs"
      borderRadius="full"
    >
      <Text
        variant="caption-md"
        fontWeight="bold"
        style={{ color: statusColor }}
      >
        {statusLabel}
      </Text>
    </Box>
  );

  const renderItemRow = (item: EnrichedShipment['items'][number]) => (
    <Box
      key={item.id}
      flexDirection="row"
      alignItems="center"

      paddingVertical="s"
      gap="s"
    >
      {/* Thumbnail */}
      <Box
        width={THUMBNAIL_SIZE}
        height={THUMBNAIL_SIZE}
        borderRadius="s"
        backgroundColor="background"
        overflow="hidden"
        style={{ flexShrink: 0 }}
      >
        {item.product?.images?.[0] ? (
          <AppImage
            source={{ uri: item.product.images[0] }}
            style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
            contentFit="cover"
          />
        ) : (
          <Box
            flex={1}
            justifyContent="center"
            alignItems="center"
            backgroundColor="background"
          >
            <MaterialCommunityIcons
              name="image-off-outline"
              size={16}
              color={theme.colors.textSecondary}
            />
          </Box>
        )}
      </Box>

      {/* Name */}
      <Box flex={1} style={{ minWidth: 0 }}>
        <Text variant="body-md" numberOfLines={2} style={{ flexShrink: 1 }}>
          {item.product?.name || t('card.unknownProduct')}
        </Text>
      </Box>
    </Box>
  );

  const renderActions = () => {
    if (!hasManageOption) return null;

    return (
      <Box marginBottom="m" marginTop="m" width="100%">
        <PrimaryButton
          onPress={() => onPress?.(shipment.id)}
          style={{ width: '100%' }}
        >
          {t('actions.managePackage')}
        </PrimaryButton>
      </Box>
    );
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => onPress?.(shipment.id)}
    >
      <Box
        backgroundColor="cardBackground"
        padding="m"
        borderRadius="l"
        marginBottom="m"
      >
        {/* -- Header Row -- */}
        <Box
          flexDirection="row"
          alignItems="center"
          marginBottom="s"
          flexWrap="wrap"
          gap="xs"
        >
          {renderAvatar()}
          <Box flex={1} style={{ minWidth: 96, flexShrink: 1 }}>
            <Text variant="body-md" numberOfLines={1} style={{ flexShrink: 1 }}>
              {shipment.seller?.username || t('card.unknownSeller')}
            </Text>
          </Box>
          {renderStatusBadge()}
        </Box>

        {/* -- Product -- */}
        <Box marginBottom="s">{item ? renderItemRow(item) : null}</Box>

        {/* -- Status Line -- */}
        {statusLineContent && <Box marginBottom="s">{statusLineContent}</Box>}

        {/* -- Bottom Actions -- */}
        {renderActions()}

        {/* -- Total Price -- */}
        <Box flexDirection="row" justifyContent="flex-end">
          <Text
            variant="header-xl"
            color="primary"
            style={{ flexShrink: 1, textAlign: 'right' }}
          >
            {formatCurrency(totalAmount)}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
