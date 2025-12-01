/* eslint-disable @typescript-eslint/no-unused-vars */
import { useLocalSearchParams, Stack } from 'expo-router';
import { ScrollView } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { IconButton } from 'react-native-paper';

// Componentes Base y UI
import { Box, Text } from '../../components/base';

import { AppChip } from '../../components/ui/AppChip';

// Componentes de Layout
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { BottomActionBar } from '../../components/layout/BottomActionBar';
import { useAuthContext } from '../../components/auth/AuthProvider';

// Componentes de Feature (Producto)
import { ProductImageGallery } from '../../components/features/product/ProductImageGallery';
import { ProductSpecificationsGrid } from '../../components/features/product/ProductSpecificationsGrid';
import { ProductFavoriteButton } from '../../components/features/product/ProductFavoriteButton';
import { ProductSellerCard } from '../../components/features/product/ProductSellerCard';
import { ProductDetailSkeleton } from '../../components/features/product/ProductDetailSkeleton';
import { ProductActionButtons } from '../../components/features/product/ProductActionButtons';
import { ViewCounter } from '../../components/features/product/ViewCounter';
import { OptionsMenu } from '../../components/ui/OptionsMenu';

// Hooks y Utilidades
import { useProductShare } from '../../components/features/product/hooks/useProductShare';
import { useProduct } from '../../core/hooks/useProduct';
import { Theme } from '../../core/theme';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();
  const { t } = useTranslation(['common', 'product']);
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();

  const { data: product, isLoading, error } = useProduct(id!);

  // Hook de lógica de acciones (Carrito, Compartir)
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
          {t('product:states.productLoadError')}
        </Text>
      </Box>
    );
  }

  const isOwner = session?.user.id === product?.seller_id;

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader
        showBack={true}
        title={t('product:details.title')}
        backgroundColor="cardBackground"
        // --- AQUÍ ESTÁ LA MAGIA DEL SLOT ---
        headerRight={
          <Box flexDirection="row" alignItems="center">
            {/* Botón Compartir */}
            <IconButton
              icon="share-variant"
              iconColor={theme.colors.textPrimary}
              size={24}
              onPress={handleShare}
              style={{ margin: 0 }}
            />

            {/* Menú Genérico Inteligente */}
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
          paddingTop: insets.top + 80,
          paddingBottom: 120,
        }}
      >
        <ProductImageGallery images={product.images} />

        <Box
          marginHorizontal="m"
          padding="l"
          backgroundColor="cardBackground"
          borderRadius="l"
        >
          {/* Cabecera */}
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="flex-start"
            marginBottom="s"
          >
            {/* COLUMNA IZQUIERDA: Título, Contador y Tags */}
            <Box flex={1} marginRight="m">
              {/* Fila: Título + Contador */}
              <Box
                flexDirection="row"
                alignItems="center"
                flexWrap="wrap"
                gap="s"
              >
                <Text variant="header-xl" lineHeight={32}>
                  {product.name}
                </Text>

                {/* Aquí colocamos el contador, justo al terminar el título */}

                {/* ESTE ES EL CONTADOR DE CUANTOS USARIOS VEN EL PRODUCTO, PARA LA VERSION 1.0 LO MANTENDREMOS OCULTO PARA LUEGO SACARLO EN VERSIONES POSTERIORES */}

                {/* <ViewCounter count={product.views} /> */}
              </Box>

              {/* Etiquetas usando AppChip */}
              <Box
                flexDirection="row"
                flexWrap="wrap" // Permite que el Status baje si no cabe
                gap="s"
                marginTop="s"
                alignItems="center"
              >
                {/* GRUPO INSEPARABLE: Categoría y Condición */}
                {/* Al ponerlos en su propio Box row SIN wrap, siempre estarán juntos */}
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

                {/* EL FLOTANTE: Status Verificado */}
                {/* Este elemento sí puede hacer wrap y bajar a la siguiente línea si falta espacio */}
                {product.status === 'VERIFIED' && (
                  <AppChip
                    label={t('product:details.verifiedStatus')}
                    icon="shield-check"
                    textColor="success"
                    backgroundColor="background"
                  />
                )}
              </Box>
            </Box>

            {/* COLUMNA DERECHA: Precio */}
            <Box alignItems="flex-end">
              <Text variant="subheader-md" color="textPrimary">
                {t('product:details.priceLabel')}
              </Text>
              <Text variant="subheader-lg" color="primary">
                ${product.price.toLocaleString('es-MX')}
              </Text>
            </Box>
          </Box>

          {/* Descripción */}
          <Text variant="subheader-lg" marginBottom="m" color="primary">
            {t('product:details.description')}
          </Text>
          <Text
            variant="body-md"
            color="textPrimary"
            style={{ lineHeight: 24 }}
          >
            {product.description}
          </Text>

          {/* Componente del Vendedor (Refactorizado) */}
          <ProductSellerCard product={product} />

          {/* Especificaciones */}
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
            <ProductActionButtons product={product} />
          </Box>
        </Box>
      </BottomActionBar>
    </Box>
  );
}
