import { useState, useMemo } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { IconButton } from 'react-native-paper';

import { Box } from '@/shared/ui/base';
import { MyListingCard } from '@/features/profile/components/my-listing-card';
import { GlobalHeader } from '@/shared/ui/global-header';
import { EmptyState } from '@/shared/ui/feedback/empty-state';
import { ConfirmDialog } from '@/shared/ui/feedback/confirm-dialog';
import { ProductCardSkeleton } from '@/shared/ui/product/product-card-skeleton';
import { SegmentedControl } from '@/shared/ui/segmented-control';
import { isProductHistory } from '@/features/profile/logic/product-status';

import { useMyListings } from '@/features/profile/hooks/use-my-listings';
import { useProductManagement } from '@/features/profile/hooks/use-product-management';
import { useSellStore } from '@/features/sell/store/use-sell-store';

import { Theme } from '@/shared/theme';
import { Product } from '@selene/types';
import { useSeleneRefresh } from '@/shared/hooks/use-selene-refresh';

export default function MyListingsScreen() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation(['profile', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Data hooks
  const { data: listings, isLoading, isRefetching, refetch } = useMyListings();
  const { isRefreshing, onRefresh } = useSeleneRefresh(refetch);
  const { deleteProduct, deletingProductId, isDeleting } =
    useProductManagement();

  const { loadProductForEdit, resetDraft } = useSellStore();

  // Local state
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

  // Show skeleton on initial load, or refetch after optimistic removal
  const showSkeleton = isLoading || (isRefetching && !listings);

  // Filtering logic (client-side — instant)
  const filteredListings = useMemo(() => {
    return listings?.filter((item) => {
      const isHistory = isProductHistory(
        item.status,
        item.status_before_account_hold,
      );

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
    router.push(`/verify/${product.id}`);
  };

  const handleDeletePress = (product: Product) => {
    setProductToDelete(product);
  };

  const confirmDelete = () => {
    if (productToDelete) {
      deleteProduct(productToDelete);
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

      {/* 1. STATUS BAR GRADIENT */}
      <LinearGradient
        colors={[theme.colors.transparent, 'transparent']}
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

      {/* 2. GLOBAL HEADER */}
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

      {/* 4. MAIN CONTENT */}
      {showSkeleton ? (
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
          // List header (tab control)
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
                isDeleting={deletingProductId === item.id}
                isInDispute={item.status === 'IN_DISPUTE'}
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
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
            />
          }
        />
      )}

      {/* 5. DELETE CONFIRMATION DIALOG */}
      <ConfirmDialog
        visible={!!productToDelete}
        title={t('profile:listings.dialog.deleteTitle')}
        description={t('profile:listings.dialog.deleteMsg')}
        onConfirm={confirmDelete}
        onCancel={() => setProductToDelete(null)}
        isDangerous
        icon="trash-can-outline"
        confirmLabel={t('common:dialog.delete')}
        loading={isDeleting}
      />
    </Box>
  );
}
