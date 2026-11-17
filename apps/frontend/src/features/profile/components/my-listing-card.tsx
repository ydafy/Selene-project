import { TouchableOpacity, View } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Product } from '@selene/types';

import { Box, Text } from '@/shared/ui/base';
import { AppImage } from '@/shared/ui/media/app-image';
import { Theme } from '@/shared/theme';
import { formatCents } from '@/shared/utils/money/format-cents';
import { formatDate } from '@/shared/utils/format-date';
import {
  getStatusColor,
  isAccountHeld,
  isProductHistory,
  resolveListingStatusKey,
} from '../logic/product-status';
import type { PaymentSetupNeed } from '@/shared/utils/payment-setup-need';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';

type MyListingCardProps = {
  product: Product;
  onPress: (product: Product) => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onVerify?: (product: Product) => void;
  isDeleting?: boolean;
  isInDispute?: boolean;
  orderId?: string;
  shipmentId?: string;
  /** The seller's missing payment setup; null when set up or unknown. */
  paymentNeed?: PaymentSetupNeed;
};

export const MyListingCard = ({
  product,
  onPress,
  onEdit,
  onDelete,
  onVerify,
  isDeleting = false,
  isInDispute = false,
  orderId,
  shipmentId,
  paymentNeed = null,
}: MyListingCardProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('profile');
  const router = useRouter();

  const isHeld = isAccountHeld(product);
  const isHistoryItem = isProductHistory(
    product.status,
    product.status_before_account_hold,
  );
  const statusKey = resolveListingStatusKey(product, paymentNeed);
  const statusColor = getStatusColor(statusKey);
  // A verified listing nobody can buy: the chip opens the payments guide (S4).
  const opensPayments =
    statusKey === 'PAYMENTS_SETUP' || statusKey === 'PAYMENTS_REJECTED';

  // Status action states
  const isPending = product.status === 'pending_verification';
  const isRejected = product.status === 'rejected';

  // If action required (verify or fix), prioritize over detail view
  const needsAction = isPending || isRejected;

  // Smart navigation: in_dispute → order detail with shipment focus
  const handlePress = () => {
    if (isInDispute && orderId) {
      const query = shipmentId ? `?shipment_id=${shipmentId}` : '';
      router.push(`/profile/orders/${orderId}${query}`);
      return;
    }
    if (needsAction && onVerify) {
      onVerify(product);
    } else {
      onPress(product);
    }
  };

  // Action button config
  const getActionConfig = () => {
    if (isRejected) {
      return {
        label: t('listings.actions.fix'),
        icon: 'alert-circle-outline',
        color: theme.colors.error,
        textColor: theme.colors.textPrimary,
      };
    }
    if (isPending) {
      return {
        label: t('listings.actions.verify'),
        icon: 'shield-check-outline',
        color: theme.colors.error,
        textColor: theme.colors.textPrimary,
      };
    }
    return {
      label: t('listings.actions.edit'),
      icon: 'pencil-outline',
      color: theme.colors.primary,
      textColor: theme.colors.background,
    };
  };

  const actionConfig = getActionConfig();

  // Show actions if NOT history, or if rejected (actionable from history).
  // A listing held by an account suspension has none: the server refuses both.
  const showActions = !isHeld && (!isHistoryItem || isRejected);
  // Hide trash when in_dispute
  const showTrash = !isInDispute;

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatCents(product.price_cents)}`}
      accessibilityHint={t('listings.a11y.cardHint')}
    >
      <Box
        flexDirection="row"
        backgroundColor="cardBackground"
        borderRadius="m"
        overflow="hidden"
        marginBottom="m"
        height={180}
        style={{
          shadowColor: theme.colors.pressableShadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 3,
          elevation: 3,
        }}
      >
        {/* 1. IMAGE */}
        <Box width={130} height="100%" backgroundColor="background">
          {product.images && product.images.length > 0 ? (
            <AppImage
              source={{ uri: product.images[0] }}
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <Box flex={1} justifyContent="center" alignItems="center">
              <MaterialCommunityIcons
                name="image-off-outline"
                size={24}
                color={theme.colors.textSecondary}
              />
            </Box>
          )}
        </Box>

        {/* 2. CONTENT */}
        <Box flex={1} padding="s" justifyContent="space-between">
          <Box>
            <Text variant="body-md" numberOfLines={2}>
              {product.name}
            </Text>
            <Text variant="subheader-lg" color="primary" marginTop="xs">
              {formatCents(product.price_cents)}
            </Text>
          </Box>

          {/* STATUS BADGE */}
          <TouchableOpacity
            disabled={!opensPayments}
            onPress={
              opensPayments ? () => router.push('/sell/onboarding') : undefined
            }
            activeOpacity={0.7}
            accessibilityRole={opensPayments ? 'button' : undefined}
          >
            <Box flexDirection="row" alignItems="center" marginTop="s">
              <Box
                width={8}
                height={8}
                borderRadius="full"
                backgroundColor={statusColor}
                marginRight="xs"
              />
              <Text
                variant="caption-md"
                color={opensPayments ? statusColor : 'textSecondary'}
                textDecorationLine={opensPayments ? 'underline' : 'none'}
              >
                {t(`listings.status.${statusKey}`)}
              </Text>
            </Box>
          </TouchableOpacity>

          {/* in_dispute BADGE — rendered before action bar */}
          {isInDispute && (
            <View
              accessibilityLiveRegion="polite"
              accessibilityLabel={t('listings.a11y.inDisputeBadge')}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                marginTop="xs"
                paddingVertical="xs"
                paddingHorizontal="s"
                backgroundColor="errorSubtle"
                borderRadius="s"
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.errorSubtle,
                }}
              >
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={14}
                  color={theme.colors.error}
                />
                <Text variant="caption-md" color="error" marginLeft="xs">
                  {t('listings.status.in_dispute')}
                </Text>
              </Box>
            </View>
          )}

          {/* 3. ACTION BAR */}
          {showActions ? (
            <Box flexDirection="row" alignItems="center" gap="s" marginTop="s">
              {/* DYNAMIC BUTTON (Edit / Verify / Fix) */}
              <TouchableOpacity
                onPress={() => {
                  if (needsAction && onVerify) {
                    onVerify(product);
                  } else {
                    onEdit(product);
                  }
                }}
                style={{ flex: 1 }}
              >
                <Box
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="center"
                  paddingVertical="s"
                  borderRadius="m"
                  borderWidth={1}
                  style={{
                    backgroundColor: actionConfig.color,
                    borderColor: actionConfig.color,
                  }}
                >
                  <IconButton
                    icon={actionConfig.icon}
                    size={18}
                    iconColor={actionConfig.textColor}
                    style={{ margin: 0, width: 20, height: 20 }}
                  />
                  <Text
                    variant="caption-lg"
                    marginLeft="xs"
                    style={{ color: actionConfig.textColor }}
                  >
                    {actionConfig.label}
                  </Text>
                </Box>
              </TouchableOpacity>

              {/* DELETE BUTTON — hidden when in_dispute */}
              {showTrash && (
                <Box
                  width={40}
                  height={40}
                  justifyContent="center"
                  alignItems="center"
                  borderRadius="m"
                  backgroundColor="background"
                >
                  <IconButton
                    icon="trash-can-outline"
                    size={22}
                    iconColor={theme.colors.error}
                    onPress={() => onDelete(product)}
                    style={{ margin: 0 }}
                    accessibilityLabel={t('listings.a11y.deleteLabel')}
                    accessibilityHint={t('listings.a11y.deleteHint')}
                    accessibilityState={{
                      busy: isDeleting,
                      disabled: isDeleting,
                    }}
                  />
                </Box>
              )}
            </Box>
          ) : (
            // History-only (sold) — show date
            <Box marginTop="s">
              <Text variant="caption-md" color="textSecondary">
                {t('listings.publishedOn')} {formatDate(product.created_at)}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
