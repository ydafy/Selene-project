import { useState, useMemo } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { IconButton } from 'react-native-paper';

import { Box } from '../../components/base';
import { MyListingCard } from '../../components/features/profile/MyListingCard';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ProductCardSkeleton } from '../../components/features/product/ProductCardSkeleton';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { isProductHistory } from '../../core/utils/product-status';

import { useMyListings } from '../../core/hooks/useMyListings';
import { useProductManagement } from '../../core/hooks/useProductManagement';
import { useSellStore } from '../../core/store/useSellStore';

import { Theme } from '../../core/theme';
import { Product } from '@selene/types';

export default function MyListingsScreen() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation(['profile', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Hooks de Datos
  const { data: listings, isLoading, refetch } = useMyListings();
  const { deleteProduct } = useProductManagement();

  const { loadProductForEdit, resetDraft } = useSellStore();

  // Estado Local
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const tabOptions = useMemo(
    () => [
      t('profile:listings.tabs.active'),
      t('profile:listings.tabs.history'),
    ],
    [t],
  );

  const hasRejected = !!listings?.some((item) => item.status === 'REJECTED');
  const showHistoryBadge = hasRejected && selectedIndex !== 1;
  const badgesConfig = [false, showHistoryBadge];

  // Lógica de Filtrado (Client Side - Instantáneo)
  const filteredListings = useMemo(() => {
    return listings?.filter((item) => {
      // Usamos la "Fuente de Verdad"
      const isHistory = isProductHistory(item.status);

      if (selectedIndex === 0) return !isHistory;
      return isHistory;
    });
  }, [listings, selectedIndex]);

  // Handlers
  const handleEdit = (product: Product) => {
    loadProductForEdit(product);

    router.push('/sell/details');
  };

  const handleVerify = (product: Product) => {
    // Navegamos a la pantalla de verificación
    router.push(`/verify/${product.id}`);
  };

  const handleDeletePress = (product: Product) => {
    setProductToDelete(product);
  };

  const confirmDelete = () => {
    if (productToDelete) {
      deleteProduct(productToDelete.id);
      setProductToDelete(null);
    }
  };

  const handleCreateNew = () => {
    resetDraft();
    router.push(`/sell`);
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* 1. GRADIENTE DE STATUS BAR */}
      <LinearGradient
        colors={[theme.colors.background, 'transparent']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top + 20,
          zIndex: 101,
        }}
        pointerEvents="none"
      />

      {/* 2. HEADER GLOBAL */}
      <GlobalHeader
        title={t('profile:listings.title')}
        showBack={true}
        backgroundColor="cardBackground"
        headerRight={
          <IconButton
            icon="plus"
            iconColor={theme.colors.primary}
            size={24}
            onPress={handleCreateNew}
            style={{ margin: 0 }}
          />
        }
      />

      {/* 3. GRADIENTE DE "NIEBLA" (Debajo del Header) */}
      <LinearGradient
        colors={[theme.colors.background, 'transparent']}
        style={{
          position: 'absolute',
          top: insets.top + 60,
          left: 0,
          right: 0,
          height: 40,
          zIndex: 10,
        }}
        pointerEvents="none"
      />

      {/* 4. CONTENIDO PRINCIPAL */}
      {isLoading ? (
        <Box padding="m" style={{ paddingTop: insets.top + 90 }}>
          <ProductCardSkeleton height={130} />
          <ProductCardSkeleton height={130} />
          <ProductCardSkeleton height={130} />
        </Box>
      ) : (
        <FlatList
          data={filteredListings}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          // Header de la lista (El control de pestañas)
          ListHeaderComponent={
            <Box paddingHorizontal="m" paddingBottom="m">
              <SegmentedControl
                options={tabOptions}
                selectedIndex={selectedIndex}
                onChange={setSelectedIndex}
                badges={badgesConfig}
              />
            </Box>
          }
          contentContainerStyle={{
            paddingTop: insets.top + 90,
            paddingBottom: 100,
          }}
          renderItem={({ item }) => (
            <Box paddingHorizontal="m">
              <MyListingCard
                product={item}
                onPress={(p) => router.push(`/product/${p.id}`)}
                onEdit={handleEdit}
                onDelete={handleDeletePress}
                onVerify={handleVerify}
              />
            </Box>
          )}
          ListEmptyComponent={
            <Box marginTop="xl" paddingHorizontal="m">
              <EmptyState
                icon={selectedIndex === 0 ? 'tag-outline' : 'history'}
                title={t('profile:listings.emptyTitle')}
                message={t('profile:listings.emptyMsg')}
              />
            </Box>
          }
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={theme.colors.primary}
            />
          }
        />
      )}

      {/* 5. DIÁLOGO DE BORRADO */}
      <ConfirmDialog
        visible={!!productToDelete}
        title={t('common:dialog.delete')}
        description={t('cart:dialog.removeItemMsg')} // Reutilizamos mensaje o creamos uno específico
        onConfirm={confirmDelete}
        onCancel={() => setProductToDelete(null)}
        isDangerous
        icon="trash-can-outline"
        confirmLabel={t('common:dialog.delete')}
      />
    </Box>
  );
}
