import { useLocalSearchParams, Stack } from 'expo-router';
import { ScrollView } from 'react-native'; // ScrollView normal
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { IconButton } from 'react-native-paper';

// Componentes Base y UI
import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';

// Componentes de Layout
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { BottomActionBar } from '../../components/layout/BottomActionBar';

// Componentes de Feature (Producto)
import { ProductImageGallery } from '../../components/features/product/ProductImageGallery';
import { ProductSpecificationsGrid } from '../../components/features/product/ProductSpecificationsGrid';
import { ProductFavoriteButton } from '../../components/features/product/ProductFavoriteButton';
import { ProductSellerCard } from '../../components/features/product/ProductSellerCard';
import { ProductDetailSkeleton } from '../../components/features/product/ProductDetailSkeleton';
import { OptionsMenu } from '../../components/ui/OptionsMenu';
//import { ViewCounter } from '../../components/features/product/ViewCounter';
import { AppChip } from '../../components/ui/AppChip';

// Hooks y Utilidades
import { useProductCart } from '../../components/features/product/hooks/useProductCart';
import { useProductShare } from '../../components/features/product/hooks/useProductShare';
import { useProduct } from '../../core/hooks/useProduct';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { Theme } from '../../core/theme';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();
  const { t } = useTranslation('product');
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();

  const { data: product, isLoading, error } = useProduct(id!);

  const { handleAddToCart, isAddingToCart, isAdded } = useProductCart(product);
  const { handleShare } = useProductShare(product);

  if (isLoading) {
    return <ProductDetailSkeleton />;
  }

  if (error || !product) {
    return (
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        backgroundColor="background"
      >
        <Text variant="body-md" color="error">
          {t('errorLoading')}
        </Text>
      </Box>
    );
  }

  const isOwner = session?.user.id === product.seller_id;

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header Estático */}
      <GlobalHeader
        showBack={true}
        title={t('details.title')}
        backgroundColor="cardBackground"
        headerRight={
          <Box flexDirection="row" alignItems="center">
            <IconButton
              icon="share-variant"
              iconColor={theme.colors.textPrimary}
              size={24}
              onPress={handleShare}
              style={{ margin: 0 }}
            />

            <OptionsMenu
              targetId={product.id}
              sellerId={product.seller_id}
              context="product"
              isOwner={isOwner}
            />
          </Box>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 90, // Espacio para el header flotante
          paddingBottom: 120,
        }}
      >
        <ProductImageGallery images={product.images} productId={product.id} />

        <Box
          marginHorizontal="m"
          padding="l"
          backgroundColor="cardBackground"
          borderRadius="l"
        >
          {/* Cabecera interna */}
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="flex-start"
            marginBottom="s"
          >
            <Box flex={1} marginRight="m">
              {/* Título y Contador */}
              <Box
                flexDirection="row"
                alignItems="center"
                flexWrap="wrap"
                gap="s"
              >
                <Text variant="header-xl" lineHeight={32}>
                  {product.name}
                </Text>
                {/* ViewCounter (Oculto por ahora según decisión de negocio, pero el código está listo) */}
                {/* <ViewCounter count={product.views} /> */}
              </Box>

              {/* Etiquetas */}
              <Box
                flexDirection="row"
                flexWrap="wrap"
                gap="s"
                marginBottom="s"
                marginTop="s"
                alignItems="center"
              >
                <Box flexDirection="row" gap="s">
                  <AppChip
                    label={product.category}
                    textColor="primary"
                    backgroundColor="background"
                    onPress={() => console.log('Filtrar por categoría')}
                  />
                  <AppChip
                    label={product.condition}
                    textColor="textPrimary"
                    backgroundColor="background"
                  />
                </Box>

                {product.status === 'VERIFIED' && (
                  <AppChip
                    label={t('verifiedStatus')}
                    icon="shield-check"
                    textColor="success"
                    backgroundColor="background"
                  />
                )}
              </Box>
            </Box>

            <Box alignItems="flex-end">
              <Text variant="subheader-md" color="textSecondary">
                {t('details.priceLabel')}
              </Text>
              <Text variant="header-xl" color="primary">
                ${product.price.toLocaleString('es-MX')}
              </Text>
            </Box>
          </Box>

          <Text
            variant="subheader-lg"
            color="primary"
            alignItems="flex-start"
            marginBottom="s"
          >
            {t('product:details.description')}
          </Text>

          <Text
            variant="body-md"
            color="textPrimary"
            style={{ lineHeight: 24 }}
          >
            {product.description}
          </Text>

          <ProductSellerCard product={product} />

          <ProductSpecificationsGrid specs={product.specifications} />
        </Box>
      </ScrollView>

      {/* Barra Inferior */}
      <BottomActionBar>
        <Box flexDirection="row" gap="m" alignItems="center">
          <Box flex={0.2} alignItems="center" justifyContent="center">
            <ProductFavoriteButton productId={product.id} size={24} />
          </Box>

          <Box flex={1}>
            <PrimaryButton
              onPress={handleAddToCart}
              loading={isAddingToCart}
              disabled={isAddingToCart}
              variant={isAdded ? 'outline' : 'solid'}
              icon={isAdded ? 'check' : 'cart-outline'}
            >
              {isAdded ? t('actions.added') : t('actions.addToCart')}
            </PrimaryButton>
          </Box>
        </Box>
      </BottomActionBar>
    </Box>
  );
}
