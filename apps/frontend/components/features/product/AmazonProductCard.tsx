import { TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { Product } from '@selene/types';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Theme } from '../../../core/theme';
import { useProductCart } from './hooks/useProductCart';

type ProductCardProps = {
  product: Product;
  onPress: (product: Product) => void;
};

export const AmazonProductCard = ({ product, onPress }: ProductCardProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('common');

  // Conectamos la lógica del carrito directamente a la tarjeta
  const { handleAddToCart, isAddingToCart, isAdded } = useProductCart(product);

  return (
    <TouchableOpacity
      onPress={() => onPress(product)}
      activeOpacity={0.9}
      style={{ marginBottom: 20 }}
    >
      <Box
        backgroundColor="cardBackground"
        borderRadius="m"
        overflow="hidden"
        // Sombra flotante consistente
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 4.65,
          elevation: 8,
        }}
      >
        {/* --- SECCIÓN SUPERIOR: INFO (Fila) --- */}
        <Box flexDirection="row" padding="m">
          {/* 1. Imagen (Izquierda) */}
          <Box
            width={160}
            height={160}
            backgroundColor="background"
            borderRadius="s"
            overflow="hidden"
            marginRight="m"
          >
            <AppImage
              source={{ uri: product.images[0] }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
            {/* Badge de Verificado (Mini) */}
            {product.status === 'VERIFIED' && (
              <Box
                position="absolute"
                bottom={0}
                left={0}
                right={0}
                backgroundColor="success"
                padding="xs"
                alignItems="center"
              >
                <Text
                  variant="body-sm"
                  style={{ fontSize: 8, color: 'white', fontWeight: 'bold' }}
                >
                  VERIFICADO
                </Text>
              </Box>
            )}
          </Box>

          {/* 2. Detalles (Derecha) */}
          <Box flex={1} justifyContent="space-between">
            <Box>
              <Text
                variant="body-md"
                fontWeight="bold"
                numberOfLines={2}
                marginBottom="xs"
              >
                {product.name}
              </Text>
              <Text variant="caption-md" color="textSecondary">
                {product.category} • {product.condition}
              </Text>
              {/* Aquí podrías poner estrellas de rating en el futuro */}
            </Box>

            <Box>
              <Text
                variant="caption-md"
                color="textSecondary"
                style={{ fontSize: 10 }}
              >
                Precio:
              </Text>
              <Text variant="header-xl" color="primary">
                ${product.price.toLocaleString('es-MX')}
              </Text>
            </Box>
          </Box>
        </Box>

        {/* --- SECCIÓN INFERIOR: ACCIÓN RÁPIDA --- */}
        <Box paddingHorizontal="m" paddingBottom="m">
          <PrimaryButton
            onPress={handleAddToCart}
            loading={isAddingToCart}
            disabled={isAddingToCart}
            variant={isAdded ? 'outline' : 'solid'}
            // Usamos iconos estándar que sabemos que existen
            icon={isAdded ? 'check' : 'cart-outline'}
            // Eliminamos el style de height fijo que rompía el layout
            labelStyle={{
              fontSize: 15,
              marginVertical: 0, // Importante para que no se corte
              lineHeight: 12, // Alineación vertical
            }}
            contentStyle={{
              height: 36, // Altura compacta
            }}
            style={{
              borderRadius: theme.borderRadii.m,
            }}
          >
            {isAdded ? t('product.added') : t('product.addToCart')}
          </PrimaryButton>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
