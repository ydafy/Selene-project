import React from 'react';
import { useTheme } from '@shopify/restyle';
import { Product } from '@selene/types';
import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { AppChip } from '../../ui/AppChip';
import { Theme } from '../../../core/theme';
import { formatCurrency } from '../../../core/utils/format';

interface CheckoutItemProps {
  product: Product;
  isUnavailable?: boolean;
}

export const CheckoutItem = ({ product, isUnavailable }: CheckoutItemProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box
      flexDirection="row"
      backgroundColor="cardBackground"
      borderRadius="m"
      padding="s"
      marginBottom="s"
      alignItems="center"
      borderWidth={1}
      borderColor={isUnavailable ? 'error' : 'background'}
      opacity={isUnavailable ? 0.6 : 1}
    >
      <Box
        height={110}
        width={110}
        borderRadius="s"
        overflow="hidden"
        backgroundColor="background"
        marginRight="m"
      >
        <AppImage
          source={{
            uri: product.images?.[0] || 'https://via.placeholder.com/80',
          }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
        />
      </Box>

      <Box flex={1} justifyContent="space-between" minHeight={80}>
        <Box>
          <Text variant="body-md" fontWeight="bold" numberOfLines={2}>
            {product.name}
          </Text>
          <Box flexDirection="row" marginTop="xs">
            <AppChip
              label={isUnavailable ? 'No disponible' : product.condition}
              textColor={isUnavailable ? 'textPrimary' : 'textSecondary'}
              backgroundColor={isUnavailable ? 'error' : 'background'}
            />
          </Box>
        </Box>
        <Text variant="body-md" color="primary" fontWeight="700">
          {formatCurrency(product.price)}
        </Text>
      </Box>
    </Box>
  );
};
