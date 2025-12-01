import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Product } from '@selene/types';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';

type ProductSellerCardProps = {
  /**
   * Recibimos el producto completo porque la información del vendedor
   * viene adjunta (JOIN) en una propiedad que no está en el tipo base.
   */
  product: Product;
};

export const ProductSellerCard = ({ product }: ProductSellerCardProps) => {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { t } = useTranslation(['common', 'product']);

  // Lógica de extracción de datos encapsulada aquí
  // (product as any) es necesario porque 'profiles' es un dato unido por Supabase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seller = (product as any).profiles as {
    id: string;
    username?: string;
    avatar_url?: string;
  } | null;
  const sellerName = seller?.username ?? 'Usuario';

  const handlePress = () => {
    if (seller?.id) {
      router.push({
        pathname: '/profile/[id]',
        params: { id: seller.id },
      });
    }
  };

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
          {seller?.avatar_url ? (
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
          <Text variant="body-md" fontWeight="bold">
            @{sellerName}
          </Text>
          <Text variant="caption-md" color="success">
            {t('product:details.verifiedMember')}
          </Text>
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
