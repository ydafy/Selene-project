import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Importamos el tipo enriquecido que creamos en index.ts
import { ProductWithSeller } from '@selene/types';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';

type ProductSellerCardProps = {
  product: ProductWithSeller;
};

export const ProductSellerCard = ({ product }: ProductSellerCardProps) => {
  const theme = useTheme<Theme>();
  const router = useRouter();

  // FIX: Ahora leemos 'seller' directamente sin usar 'any'
  const seller = product.seller;
  const sellerName = seller?.username ?? 'Usuario';

  const handlePress = () => {
    if (seller?.id) {
      router.push({
        pathname: '/profile/[id]',
        params: { id: seller.id },
      });
    }
  };

  // Si por alguna razón el vendedor ya no existe en la DB, mostramos un fallback inactivo
  if (!seller) {
    return (
      <Box flexDirection="row" alignItems="center" marginTop="l" padding="s">
        <Text variant="body-md" color="textSecondary">
          Vendedor no disponible
        </Text>
      </Box>
    );
  }

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={handlePress}>
      <Box
        flexDirection="row"
        alignItems="center"
        marginTop="l"
        padding="s"
        borderRadius="m"
        borderWidth={2}
        borderColor="background"
        style={{ borderStyle: 'solid' }}
      >
        <Box marginRight="m">
          {seller.avatar_url ? (
            <AppImage
              source={{ uri: seller.avatar_url }}
              style={{ width: 40, height: 40, borderRadius: 20 }}
            />
          ) : (
            <Box
              width={40}
              height={40}
              borderRadius="l"
              justifyContent="center"
              alignItems="center"
              backgroundColor="primary"
            >
              <Text variant="subheader-md" fontWeight="bold" color="background">
                {sellerName.charAt(0).toUpperCase()}
              </Text>
            </Box>
          )}
        </Box>

        <Box flex={1}>
          {/* FILA 1: NOMBRE + ICONO (Solo si es VIP) */}
          <Box flexDirection="row" alignItems="center">
            <Text variant="body-md" fontWeight="bold">
              @{sellerName}
            </Text>

            {/* EL ICONO: Solo aparece si es verificado */}
            {seller.is_verified_seller && (
              <MaterialCommunityIcons
                name="check-decagram"
                size={16}
                color={theme.colors.primary}
                style={{ marginLeft: 4 }}
              />
            )}
          </Box>

          {/* FILA 2: TEXTO DE RESPALDO (Solo si es VIP) */}
          {seller.is_verified_seller && (
            <Text
              variant="caption-md"
              color="primary"
              marginTop="xs"
              fontWeight="600"
            >
              Verificado por Selene
            </Text>
          )}
        </Box>
        <IconButton
          icon="chevron-right"
          iconColor={theme.colors.textPrimary}
          size={20}
          style={{ margin: 0 }}
        />
      </Box>
    </TouchableOpacity>
  );
};
