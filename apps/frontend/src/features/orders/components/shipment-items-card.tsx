import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import type { EnrichedShipment } from '@selene/types';

import { Box, Text } from '@/shared/ui/base';
import { AppImage } from '@/shared/ui/media/app-image';
import { formatCurrency } from '@/shared/utils/money/format-currency';
import { Theme } from '@/shared/theme';
import { cardStyles } from './order-card-styles';

interface ShipmentItemsCardProps {
  items: EnrichedShipment['items'] | undefined;
  isBuyer: boolean;
  isSeller: boolean | undefined;
  total: number;
  isReviewed: (productId: string) => boolean;
  onOpenProduct: (productId: string) => void;
}

export function ShipmentItemsCard({
  items,
  isBuyer,
  isSeller,
  total,
  isReviewed,
  onOpenProduct,
}: ShipmentItemsCardProps) {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <Box {...cardStyles} overflow="hidden">
      <Text variant="header-xl" color="primary" marginBottom="m">
        {isBuyer
          ? t('orders:detail.itemsTitlePurchased')
          : t('orders:detail.itemsTitleSold')}
      </Text>
      {items?.map((item, index) => (
        <TouchableOpacity
          key={item.id}
          onPress={() => onOpenProduct(item.product_id)}
        >
          <Box
            padding="m"
            flexDirection="row"
            alignItems="center"
            borderBottomWidth={index === items.length - 1 ? 0 : 1}
            borderBottomColor="separator"
          >
            <Box
              width={60}
              height={60}
              borderRadius="m"
              overflow="hidden"
              backgroundColor="background"
            >
              {item.product?.images?.[0] && (
                <AppImage
                  source={{ uri: item.product.images[0] }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              )}
            </Box>
            <Box flex={1} marginLeft="m">
              <Text variant="body-md" numberOfLines={1}>
                {item.product?.name || t('common:states.unknownProduct')}
              </Text>
              <Text variant="body-sm" color="primary" marginTop="xs">
                {formatCurrency(item.price_at_purchase)}
              </Text>
              {/* V2: per-product reviewed badge.
                  Shows "Calificado" checkmark when buyer already reviewed
                  this product. The review CTA button is rendered as a
                  PrimaryButton at the bottom of the screen instead of
                  inline to meet sizing and accessibility targets. */}
              {isReviewed(item.product_id) ? (
                <Box
                  flexDirection="row"
                  alignItems="center"
                  gap="xs"
                  marginTop="xs"
                >
                  <MaterialCommunityIcons
                    name="check-decagram"
                    size={16}
                    color={theme.colors.success}
                  />
                  <Text variant="caption-md" color="success">
                    {t('orders:actions.reviewed')}
                  </Text>
                </Box>
              ) : null}
            </Box>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={theme.colors.textSecondary}
            />
          </Box>
        </TouchableOpacity>
      )) ?? (
        <Text variant="body-md" color="textSecondary" padding="m">
          {t('orders:detail.noItems')}
        </Text>
      )}
      <Box
        padding="m"
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Text variant="body-md" color="textSecondary">
          {isSeller ? t('orders:detail.totalSold') : t('orders:detail.total')}
        </Text>
        <Text variant="subheader-lg" color="primary">
          {formatCurrency(total)}
        </Text>
      </Box>
    </Box>
  );
}
