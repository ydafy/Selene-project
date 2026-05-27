import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Componentes Base y UI
import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { AppChip } from '../../components/ui/AppChip';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'; // <--- 1. NUEVO IMPORT

// Componentes de Layout
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { BottomActionBar } from '../../components/layout/BottomActionBar';

// Componentes de Feature (Producto)
import { ProductImageGallery } from '../../components/features/product/ProductImageGallery';
import { ProductSpecificationsGrid } from '../../components/features/product/ProductSpecificationsGrid';
import { ProductSellerCard } from '../../components/features/product/ProductSellerCard';

// Hooks y Utilidades
import { useSellStore } from '../../core/store/useSellStore';
import { usePublishProduct } from '../../core/hooks/usePublishProduct';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { normalize } from '../../core/utils/compare';

import { ProductCategory, ProductWithSeller, Profile } from '@selene/types';

export default function SellPreviewScreen() {
  const { t } = useTranslation(['sell', 'product', 'common']);

  const insets = useSafeAreaInsets();

  // Hooks de Lógica
  const { draft, originalData } = useSellStore(); // <--- 2. TRAEMOS originalData
  const { publish, isPublishing } = usePublishProduct();
  const { session } = useAuthContext();

  // Estado para el diálogo de advertencia
  const [showWarning, setShowWarning] = useState(false);

  // Construimos el objeto "Fake Product" para la vista previa
  const previewProduct: ProductWithSeller = {
    // Datos del Draft
    id: draft.id || 'preview_mode',
    name: draft.name,
    description: draft.description,
    price: Number(draft.price),
    category: draft.category as ProductCategory,
    condition: draft.condition,
    usage: draft.usage,
    images: draft.images,
    specifications: draft.specifications,

    // Metadatos de la DB (Mocks)
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'PENDING_VERIFICATION',
    seller_id: session?.user.id || 'yo',
    views: 0,
    aspect_ratio: 1,
    deleted_at: null,
    fts: null,
    locked_at: null,
    locked_by: null,
    origin_zip: draft.origin_zip || '',
    package_preset: draft.package_preset || '',
    rejection_reason: null,
    reserved_at: null,
    shipping_cost: Number(draft.shipping_cost || 0),
    shipping_payer: draft.shipping_payer || 'buyer',
    verification_data: null,
    verified_at: null,

    // --- 🚀 MOCK DEL SELLER (Para que ProductSellerCard funcione) ---
    seller: {
      id: session?.user.id || 'me',
      username: session?.user.user_metadata.username || 'Tú',
      avatar_url: session?.user.user_metadata.avatar_url || null,
      is_verified_seller: false,
      created_at: session?.user.created_at || new Date().toISOString(),
      role: 'user',
      average_rating: 0,
      total_reviews: 0,
      total_sales: 0,
      status: 'active',
    } as Profile,
  };
  // 3. NUEVA LÓGICA DEL BOTÓN
  const handlePublishPress = () => {
    // Si no es edición (es nuevo), publicamos directo
    if (!draft.id || !originalData) {
      publish();
      return;
    }

    // Si es edición, verificamos si tocó campos "Sagrados"
    const sacredChanges =
      JSON.stringify(normalize(draft.images)) !==
        JSON.stringify(normalize(originalData.images)) ||
      JSON.stringify(normalize(draft.specifications)) !==
        JSON.stringify(normalize(originalData.specifications)) ||
      draft.category !== originalData.category;

    if (sacredChanges) {
      setShowWarning(true);
    } else {
      publish();
    }
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader
        title={t('sell:preview.title')}
        showBack={true}
        backgroundColor="cardBackground"
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 90,
          paddingBottom: 120,
        }}
      >
        <ProductImageGallery
          images={previewProduct.images}
          productId="preview"
        />

        <Box
          marginHorizontal="m"
          padding="l"
          backgroundColor="cardBackground"
          borderRadius="l"
        >
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="flex-start"
            marginBottom="s"
          >
            <Box flex={1} marginRight="m">
              <Text variant="header-xl" lineHeight={32}>
                {previewProduct.name}
              </Text>

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
                <AppChip
                  label={draft.id ? 'Editando' : 'Borrador'} // Feedback visual
                  icon="eye"
                  textColor="textSecondary"
                  backgroundColor="background"
                />
              </Box>
            </Box>

            <Box alignItems="flex-end">
              <Text variant="subheader-md" color="textSecondary">
                {t('product:details.priceLabel')}
              </Text>
              <Text variant="header-xl" color="primary">
                ${previewProduct.price.toLocaleString('es-MX')}
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
            {previewProduct.description}
          </Text>

          <ProductSellerCard product={previewProduct} />

          <ProductSpecificationsGrid specs={previewProduct.specifications} />
        </Box>
      </ScrollView>

      <BottomActionBar>
        <Box flex={1}>
          <PrimaryButton
            onPress={handlePublishPress} // <--- Usamos el nuevo handler
            loading={isPublishing}
            disabled={isPublishing}
            icon="check-circle-outline"
          >
            {/* Texto dinámico: Publicar o Guardar Cambios */}
            {isPublishing
              ? t('sell:preview.publishing')
              : draft.id
                ? 'Guardar Cambios'
                : t('sell:preview.publish')}
          </PrimaryButton>
        </Box>
      </BottomActionBar>

      {/* 4. DIÁLOGO DE ADVERTENCIA */}
      <ConfirmDialog
        visible={showWarning}
        title={t('sell:dialogs.title')}
        description={t('sell:dialogs.message')}
        onConfirm={() => {
          setShowWarning(false);
          publish(); // Si acepta, publicamos (y el hook se encarga de resetear el status)
        }}
        onCancel={() => setShowWarning(false)}
        confirmLabel={t('common:dialog.confirm')}
        cancelLabel={t('common:dialog.cancel')}
        isDangerous={true} // Rojo para alertar
        icon="alert-circle-outline"
      />
    </Box>
  );
}
