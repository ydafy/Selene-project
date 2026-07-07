import React, { useState, useMemo } from 'react';
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
import { formatCurrency } from '../../core/utils/format';
import { buildPreviewProduct } from '../../core/utils/previewProductBuilder';
import { describeUploadState } from '../../core/utils/describeUploadState';
import { countUploadState } from '../../core/utils/countUploadState';

import { ProductWithSeller } from '@selene/types';

export default function SellPreviewScreen() {
  const { t } = useTranslation(['sell', 'product', 'common']);

  const insets = useSafeAreaInsets();

  // Hooks de Lógica
  const draft = useSellStore((state) => state.draft);
  const originalData = useSellStore((state) => state.originalData);
  const { publish, isPublishing, uploadProgress } = usePublishProduct();
  const { session } = useAuthContext();

  // Estado para el diálogo de advertencia
  const [showWarning, setShowWarning] = useState(false);

  // Memoize the preview mock so unrelated store changes do not rebuild it.
  const previewProduct: ProductWithSeller = useMemo(() => {
    const seller = {
      id: session?.user.id || 'me',
      username: session?.user.user_metadata?.username || null,
      avatar_url: session?.user.user_metadata?.avatar_url || null,
      is_verified_seller:
        session?.user.user_metadata?.is_verified_seller ?? false,
      created_at: session?.user.created_at || new Date().toISOString(),
      updated_at: session?.user.updated_at || null,
      average_rating: 0,
      total_reviews: 0,
      total_sales: 0,
    };

    return buildPreviewProduct(draft, seller);
  }, [draft, session]);

  // Deterministic aggregate count: Supabase Storage onUploadProgress is unproven,
  // so we only count images that have reached `done`.
  const { completed: uploadedCount, total: imageTotal } = countUploadState(
    uploadProgress,
    draft.images,
  );
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
                  label={draft.id ? t('sell:preview.editing') : t('sell:preview.draft')}
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
                {formatCurrency(previewProduct.price)}
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
          {isPublishing && (
            <>
              {imageTotal > 0 && (
                <Text
                  variant="body-sm"
                  color="textSecondary"
                  textAlign="center"
                  marginBottom="s"
                >
                  {t('sell:preview.uploadCount', {
                    completed: uploadedCount,
                    total: imageTotal,
                  })}
                </Text>
              )}
              <Box marginBottom="s">
                {draft.images.map((uri) => {
                  const { labelKey, progress } = describeUploadState(
                    uploadProgress[uri],
                  );
                  return (
                    <Text
                      key={uri}
                      variant="caption-md"
                      color="textSecondary"
                      textAlign="center"
                    >
                      {progress !== undefined
                        ? t(labelKey, { progress })
                        : t(labelKey)}
                    </Text>
                  );
                })}
              </Box>
            </>
          )}
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
                ? t('sell:preview.saveChanges')
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
