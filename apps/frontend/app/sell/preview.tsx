import React from 'react';
import { ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Componentes Base y UI
import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { AppChip } from '../../components/ui/AppChip';

// Componentes de Layout
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { BottomActionBar } from '../../components/layout/BottomActionBar'; // Usamos tu barra inferior

// Componentes de Feature (Producto)
import { ProductImageGallery } from '../../components/features/product/ProductImageGallery';
import { ProductSpecificationsGrid } from '../../components/features/product/ProductSpecificationsGrid';
import { ProductSellerCard } from '../../components/features/product/ProductSellerCard';

// Hooks y Utilidades
import { useSellStore } from '../../core/store/useSellStore';
import { usePublishProduct } from '../../core/hooks/usePublishProduct';
import { useAuthContext } from '../../components/auth/AuthProvider';

import { Product } from '@selene/types';

export default function SellPreviewScreen() {
  const { t } = useTranslation(['sell', 'product', 'common']);

  const insets = useSafeAreaInsets();

  // Hooks de Lógica
  const { draft } = useSellStore();
  const { publish, isPublishing } = usePublishProduct();
  const { session } = useAuthContext();

  // Construimos el objeto "Fake Product" para engañar a los componentes visuales
  // Usamos los datos del draft + datos del usuario actual
  const previewProduct: Product = {
    id: 'preview_mode', // ID falso
    created_at: new Date().toISOString(),
    name: draft.name,
    description: draft.description,
    price: Number(draft.price),
    category: draft.category!,
    condition: draft.condition,
    usage: 'No especificado',
    images: draft.images, // URIs locales
    status: 'PENDING_VERIFICATION',
    seller_id: session?.user.id || 'me',
    views: 0,
    aspect_ratio: 1, // Se recalculará al subir, aquí usamos default
    specifications: draft.specifications,
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header Estático (Sin botón share, solo Back) */}
      <GlobalHeader
        title={t('sell:preview.title')} // "Resumen"
        showBack={true}
        backgroundColor="cardBackground"
      />

      <ScreenLayout disableSafeArea>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingTop: insets.top + 90, // Mismo spacing que ProductDetail
            paddingBottom: 120,
          }}
        >
          {/* 1. Galería */}
          <ProductImageGallery
            images={previewProduct.images}
            productId="preview"
          />

          {/* 2. Tarjeta Principal (Diseño idéntico a ProductDetail) */}
          <Box
            marginHorizontal="m"
            padding="l"
            backgroundColor="cardBackground"
            borderRadius="l"
          >
            {/* Cabecera interna: Título y Precio */}
            <Box
              flexDirection="row"
              justifyContent="space-between"
              alignItems="flex-start"
              marginBottom="s"
            >
              <Box flex={1} marginRight="m">
                {/* Título */}
                <Text variant="header-xl" lineHeight={32}>
                  {previewProduct.name}
                </Text>

                {/* Etiquetas */}
                <Box
                  flexDirection="row"
                  flexWrap="wrap"
                  gap="s"
                  marginBottom="s"
                  marginTop="s"
                  alignItems="center"
                >
                  <AppChip
                    label={previewProduct.category}
                    textColor="primary"
                    backgroundColor="background"
                  />
                  <AppChip
                    label={previewProduct.condition}
                    textColor="textPrimary"
                    backgroundColor="background"
                  />
                  {/* Chip extra visual para indicar que es Preview */}
                  <AppChip
                    label="Borrador"
                    icon="eye"
                    textColor="textSecondary"
                    backgroundColor="background"
                  />
                </Box>
              </Box>

              {/* Precio */}
              <Box alignItems="flex-end">
                <Text variant="subheader-md" color="textSecondary">
                  {t('product:details.priceLabel')}
                </Text>
                <Text variant="header-xl" color="primary">
                  ${previewProduct.price.toLocaleString('es-MX')}
                </Text>
              </Box>
            </Box>

            {/* Descripción */}
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
              {previewProduct.description}
            </Text>

            {/* Tarjeta del Vendedor (Mostrando al usuario actual) */}
            <ProductSellerCard product={previewProduct} />

            {/* Grid de Especificaciones */}
            <ProductSpecificationsGrid specs={previewProduct.specifications} />
          </Box>
        </ScrollView>

        {/* 3. Barra Inferior de Acción (Reemplaza AddToCart con Publicar) */}
        <BottomActionBar>
          <Box flex={1}>
            <PrimaryButton
              onPress={publish}
              loading={isPublishing}
              disabled={isPublishing}
              icon="check-circle-outline"
            >
              {isPublishing
                ? t('sell:preview.publishing')
                : t('sell:preview.publish')}
            </PrimaryButton>
          </Box>
        </BottomActionBar>
      </ScreenLayout>
    </Box>
  );
}
