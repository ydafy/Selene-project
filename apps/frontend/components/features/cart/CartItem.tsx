import { TouchableOpacity } from 'react-native';
import { IconButton } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
//import { useTranslation } from 'react-i18next';
import { Product } from '@selene/types';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { AppChip } from '../../ui/AppChip';
import { Theme } from '../../../core/theme';

type CartItemProps = {
  product: Product;
  onPress: (product: Product) => void;
  onRemove: (productId: string) => void;
  isUnavailable?: boolean;
};

export const CartItem = ({
  product,
  onPress,
  onRemove,
  isUnavailable,
}: CartItemProps) => {
  const theme = useTheme<Theme>();
  //const { t } = useTranslation('common');

  return (
    <TouchableOpacity
      onPress={() => onPress(product)}
      activeOpacity={0.7}
      disabled={isUnavailable} // Deshabilitamos el click si no está disponible
    >
      <Box
        flexDirection="row"
        backgroundColor="cardBackground"
        borderRadius="m"
        padding="s"
        marginBottom="m"
        alignItems="center"
        borderWidth={1}
        // Si no está disponible, borde rojo y opacidad reducida
        borderColor={isUnavailable ? 'error' : 'background'}
        opacity={isUnavailable ? 0.6 : 1}
        style={{ elevation: 2 }}
      >
        {/* 1. IMAGEN */}
        <Box
          height={100}
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

          {/* Overlay de "AGOTADO" sobre la imagen */}
          {isUnavailable && (
            <Box
              position="absolute"
              top={0}
              left={0}
              right={0}
              bottom={0}
              backgroundColor="focus"
              justifyContent="center"
              alignItems="center"
            >
              <Text variant="caption-md" color="error" fontWeight="bold">
                NO DISP.
              </Text>
            </Box>
          )}
        </Box>

        {/* 2. INFORMACIÓN */}
        <Box
          flex={1}
          justifyContent="space-between"
          height={120}
          paddingVertical="xs"
        >
          <Box>
            <Text
              variant="body-md"
              fontWeight="bold"
              numberOfLines={2}
              marginBottom="xs"
            >
              {product.name}
            </Text>

            {/* Mensaje de error si no está disponible */}
            {isUnavailable ? (
              <Text variant="caption-md" color="error" fontWeight="bold">
                Producto ya no disponible
              </Text>
            ) : (
              <Box flexDirection="row">
                <AppChip
                  label={product.condition}
                  textColor="textPrimary"
                  backgroundColor="background"
                />
              </Box>
            )}
          </Box>

          <Text
            variant="subheader-md"
            color={isUnavailable ? 'textSecondary' : 'primary'}
            fontWeight="700"
          >
            ${product.price.toLocaleString('es-MX')}
          </Text>
        </Box>

        {/* 3. ACCIONES (Siempre permitimos borrar) */}
        <Box
          height={90}
          justifyContent="center"
          paddingLeft="s"
          borderLeftWidth={1}
          borderLeftColor="background"
        >
          <IconButton
            icon="trash-can-outline"
            iconColor={theme.colors.error}
            size={22}
            onPress={() => onRemove(product.id)}
            style={{ margin: 0, backgroundColor: 'rgba(220, 53, 69, 0.1)' }}
          />
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
