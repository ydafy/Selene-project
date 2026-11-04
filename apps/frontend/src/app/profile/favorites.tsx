import React, { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@shopify/restyle';

import { Box } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { ProductCard } from '../../components/features/product/ProductCard';
import { ProductCardSkeleton } from '../../components/features/product/ProductCardSkeleton';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useAllFavorites } from '../../core/hooks/useAllFavorites';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useSeleneRefresh } from '../../core/hooks/useSeleneRefresh';
import { Theme } from '../../core/theme';
import type { Product } from '@selene/types';

export default function FavoritesScreen() {
  const { t } = useTranslation('profile');
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuthContext();

  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [pendingUnfavorite, setPendingUnfavorite] = useState<string | null>(
    null,
  );
  // Ref to hold the pending promise resolver across renders
  const pendingResolverRef = React.useRef<((value: boolean) => void) | null>(
    null,
  );

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAllFavorites(session?.user.id);

  const { isRefreshing, onRefresh } = useSeleneRefresh(refetch);

  const allFavorites = React.useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

  const visibleFavorites = React.useMemo(
    () => allFavorites.filter((product) => !removingIds.has(product.id)),
    [allFavorites, removingIds],
  );

  // Reconcile removingIds with server data: if an item in removingIds is still
  // present in the server response, the delete must have failed — remove it from
  // the set so the item reappears. Successful deletions naturally stay hidden
  // because the item is absent from allFavorites.
  React.useEffect(() => {
    setRemovingIds((prev) => {
      if (prev.size === 0) return prev;
      const serverIds = new Set(allFavorites.map((p) => p.id));
      const next = new Set(prev);
      let changed = false;
      for (const id of next) {
        if (serverIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allFavorites]);

  const handleProductPress = useCallback(
    (product: Product) => {
      router.push({
        pathname: '/product/[id]',
        params: { id: product.id },
      });
    },
    [router],
  );

  const handleBeforeUnfavorite = useCallback(
    (productId: string): Promise<boolean> => {
      return new Promise((resolve) => {
        setPendingUnfavorite(productId);
        pendingResolverRef.current = resolve;
      });
    },
    [],
  );

  const handleConfirmUnfavorite = useCallback(() => {
    pendingResolverRef.current?.(true);
    setPendingUnfavorite(null);
  }, []);

  const handleCancelUnfavorite = useCallback(() => {
    pendingResolverRef.current?.(false);
    setPendingUnfavorite(null);
  }, []);

  const handleFavoriteToggle = useCallback(
    (productId: string, willBeFavorite: boolean) => {
      if (!willBeFavorite) {
        // Optimistic removal — ProductFavoriteButton handles the actual mutation.
        // Query invalidation from useProductFavorite will refetch the list
        // and the item disappears naturally. On error, the refetch restores it.
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.add(productId);
          return next;
        });
      }
    },
    [],
  );

  // Show skeletons on initial load AND during pull-to-refresh (user gesture).
  // Background refetches from mutation invalidation do NOT trigger skeletons.
  const showSkeletons = isLoading || isRefreshing;

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader title={t('favorites.title')} showBack />

      {showSkeletons ? (
        <Box paddingHorizontal="m" style={{ paddingTop: insets.top + 90 }}>
          {[1, 2, 3].map((i) => (
            <ProductCardSkeleton key={i} height={200} />
          ))}
        </Box>
      ) : isError ? (
        <Box flex={1} justifyContent="center" alignItems="center" padding="xl">
          <ErrorState
            title={t('common:states.errorTitle')}
            message={error?.message || t('common:states.errorMessage')}
            onRetry={refetch}
          />
        </Box>
      ) : (
        <FlashList
          data={visibleFavorites}
          keyExtractor={(item) => item.id}
          drawDistance={500}
          contentContainerStyle={{
            paddingTop: insets.top + 80,
            paddingBottom: insets.bottom + 20,
            paddingHorizontal: 16,
          }}
          renderItem={({ item, index }) => (
            <ProductCard
              product={item}
              onPress={handleProductPress}
              imageHeight={200}
              index={index}
              onFavoriteToggle={handleFavoriteToggle}
              onBeforeUnfavorite={handleBeforeUnfavorite}
            />
          )}
          ListEmptyComponent={
            <Box marginTop="xl" alignItems="center">
              <EmptyState
                icon="heart-outline"
                title={t('favorites.emptyTitle')}
                message={t('favorites.emptyMsg')}
              />
              <Box width="100%" maxWidth={250} marginTop="l">
                <PrimaryButton
                  onPress={() => router.push('/(tabs)')}
                  variant="outline"
                >
                  {t('favorites.cta')}
                </PrimaryButton>
              </Box>
            </Box>
          }
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
              progressViewOffset={insets.top + 70}
            />
          }
        />
      )}

      <ConfirmDialog
        visible={pendingUnfavorite !== null}
        title={t('favorites.dialog.unfavoriteTitle')}
        description={t('favorites.dialog.unfavoriteMsg')}
        icon="heart-outline"
        isDangerous
        onConfirm={handleConfirmUnfavorite}
        onCancel={handleCancelUnfavorite}
        confirmLabel={t('common:dialog.delete')}
        cancelLabel={t('common:dialog.cancel')}
      />
    </Box>
  );
}
