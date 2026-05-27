import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { IconButton } from 'react-native-paper';
import { useState } from 'react';

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
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

// Hooks y Utilidades
import { useProductCart } from '../../components/features/product/hooks/useProductCart';
import { useProductShare } from '../../components/features/product/hooks/useProductShare';
import { useProduct } from '../../core/hooks/useProduct';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { Theme } from '../../core/theme';
import { useProductFavorite } from '../../core/hooks/useProductFavorite';
import { useProductHistoryStore } from '../../core/store/useProductHistoryStore';
import { formatCurrency } from '@/core/utils/format';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();
  const { t } = useTranslation('product');
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();

  const [showEducationDialog, setShowEducationDialog] = useState(false);

  const { data: product, isLoading, error } = useProduct(id || '');
  const { handleAddToCart, isAddingToCart, isAdded } = useProductCart(product);
  const { handleShare } = useProductShare(product);
  const { toggleFavorite, isFavorite } = useProductFavorite(id);
  const { addProductToHistory } = useProductHistoryStore();

  useEffect(() => {
    if (id) {
      addProductToHistory(id);
      // Aquí es donde en el futuro se podria poner: trackEvent('product_view', id)
    }
  }, [id]);

  const onAddToCartPress = async () => {
    const result = await handleAddToCart();

    if (result === 'NOT_VERIFIED') {
      // Si el hook nos dice que no está verificado, abrimos el diálogo
      setShowEducationDialog(true);
    }
  };

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
        padding="l"
      >
        <MaterialCommunityIcons
          name="package-variant-remove"
          size={64}
          color={theme.colors.textSecondary}
        />
        <Text
          variant="subheader-lg"
          color="textPrimary"
          marginTop="m"
          textAlign="center"
        >
          {t('details.notFoundTitle')}
        </Text>
        <Text
          variant="body-md"
          color="textSecondary"
          textAlign="center"
          marginTop="s"
        >
          {t('details.notFoundMessage')}
        </Text>
        <PrimaryButton onPress={() => router.back()}>
          {t('common:actions.goBack')}
        </PrimaryButton>
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
                    label={product.category ?? t('common:states.unknown')}
                    textColor="primary"
                    backgroundColor="background"
                    onPress={() => console.log('Filtrar por categoría')}
                  />
                  <AppChip
                    label={product.condition ?? ''}
                    textColor="textPrimary"
                    backgroundColor="background"
                  />
                </Box>

                {product.status === 'VERIFIED' && (
                  <AppChip
                    label={t('details.verifiedSeller')}
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
                {formatCurrency(product.price)}
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
            {product.description || t('details.noDescription')}
          </Text>

          <ProductSellerCard product={product} />

          <ProductSpecificationsGrid
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            specs={(product.specifications as Record<string, any>) || {}}
          />
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
              onPress={onAddToCartPress}
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
      <ConfirmDialog
        visible={showEducationDialog}
        title={
          product?.status === 'IN_REVIEW'
            ? t('dialogs.inReviewTitle')
            : t('dialogs.pendingTitle')
        }
        description={
          product?.status === 'IN_REVIEW'
            ? t('dialogs.inReviewMsg')
            : t('dialogs.pendingMsg')
        }
        onConfirm={() => {
          setShowEducationDialog(false);
          if (!isFavorite) toggleFavorite(); // Acción inteligente: Agrega a favoritos
        }}
        onCancel={() => setShowEducationDialog(false)}
        confirmLabel={
          isFavorite ? t('dialogs.understood') : t('dialogs.addToFavs')
        }
        cancelLabel={t('menu.cancel')}
        icon="shield-alert-outline"
        // Si ya es favorito, ocultamos cancelar para que sea solo informativo
        hideCancel={isFavorite}
      />
    </Box>
  );
}
