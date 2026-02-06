import React from 'react';
import { Product } from '@selene/types';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { AppChip } from '../../ui/AppChip';
import { formatCurrency } from '../../../core/utils/format';

type CheckoutItemProps = {
  product: Product;
};

export const CheckoutItem = ({ product }: CheckoutItemProps) => {
  return (
    <Box
      flexDirection="row"
      backgroundColor="cardBackground"
      borderRadius="m"
      padding="s"
      marginBottom="s" // Margen más pequeño que en el carrito
      alignItems="center"
      borderWidth={1}
      borderColor="background" // Borde sutil
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
      }}
    >
      {/* 1. IMAGEN */}
      <Box
        height={100} // Un poco más chica que en el carrito (100 -> 80)
        width={100}
        borderRadius="s"
        overflow="hidden"
        backgroundColor="background"
        marginRight="m"
      >
        <AppImage
          source={{ uri: product.images[0] }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
        />
      </Box>

      {/* 2. INFORMACIÓN */}
      <Box
        flex={1}
        justifyContent="space-between"
        minHeight={80}
        paddingVertical="xs"
      >
        <Box>
          <Text
            variant="body-md"
            fontWeight="bold"
            numberOfLines={2} // Solo 1 línea para ahorrar espacio vertical
            marginBottom="xs"
            style={{ lineHeight: 30 }}
          >
            {product.name}
          </Text>

          {/* Chip más pequeño o solo texto */}
          <Box flexDirection="row" alignItems="center">
            <AppChip
              label={product.condition}
              textColor="textSecondary"
              backgroundColor="background"
              style={{ height: 24, paddingHorizontal: 8 }} // Micro-ajuste
            />
          </Box>
        </Box>

        <Text
          variant="body-md" // Un poco más chico que subheader
          color="primary"
          fontWeight="700"
          marginTop="s"
        >
          {formatCurrency(product.price)}
        </Text>
      </Box>
    </Box>
  );
};
