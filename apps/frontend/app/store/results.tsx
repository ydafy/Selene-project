import { useState, useRef, useEffect } from 'react';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { FlashList, type FlashListRef } from '@shopify/flash-list'; // Importamos la clase
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';
import { BottomSheetModal } from '@gorhom/bottom-sheet';

import { Box } from '../../components/base';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ProductCard } from '../../components/features/product/ProductCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProductCardSkeleton } from '../../components/features/product/ProductCardSkeleton';

import {
  FilterModal,
  FilterState,
} from '../../components/features/search/FilterModal';
import { ResultsFilterBar } from '../../components/features/search/filters/ResultsFilterBar';

import {
  useSearchProducts,
  SearchFilters,
} from '../../components/features/search/hooks/useSearchProducts';
import { getMasonryItemHeight } from '../../core/constants/layout';
import { Theme } from '../../core/theme';
import { Product } from '@selene/types';

export default function SearchResultsScreen() {
  const { category, query } = useLocalSearchParams<{
    category?: string;
    query?: string;
  }>();
  const theme = useTheme<Theme>();
  const { t } = useTranslation('search');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const filterModalRef = useRef<BottomSheetModal>(null);

  // --- CORRECCIÓN AQUÍ ---
  // Usamos 'FlashList<Product>' directamente. No 'FlashListType'.
  const listRef = useRef<FlashListRef<Product> | null>(null);

  const [filters, setFilters] = useState<SearchFilters>({
    query: query || '',
    category: category || undefined,
    priceRange: [0, 50000],
    conditions: [],
    specs: {},
    orderBy: 'newest',
    verifiedOnly: false,
  });

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      query: query || '',
      category: category || undefined,
    }));
  }, [query, category]);

  // Efecto para Scroll to Top cuando cambian los filtros
  useEffect(() => {
    // Solo scrolleamos si la lista tiene contenido y la referencia existe
    if (listRef.current) {
      listRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  }, [filters]); // Se dispara al cambiar filtros

  const {
    data,
    isLoading,

    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSearchProducts(filters);

  const products = data?.pages.flatMap((page) => page.data) || [];

  const handleProductPress = (product: Product) => {
    router.push({
      pathname: '/product/[id]',
      params: { id: product.id },
    });
  };

  const handleFilterModalOpen = () => {
    filterModalRef.current?.present();
  };

  const handleBarUpdate = (newPart: Partial<SearchFilters>) => {
    setFilters((prev) => ({ ...prev, ...newPart }));
  };

  const handleModalApply = (modalFilters: FilterState) => {
    setFilters((prev) => ({
      ...prev,
      priceRange: modalFilters.priceRange,
      conditions: modalFilters.conditions,
      specs: modalFilters.specs,
    }));
  };

  const screenTitle = category
    ? `${t('resultsTitle')}: ${category}`
    : query
      ? `"${query}"`
      : t('resultsTitle');

  const headerTitle = category || query || t('resultsTitle');

  const hasActiveFilters =
    (filters.conditions && filters.conditions.length > 0) ||
    (filters.specs && Object.keys(filters.specs).length > 0) ||
    (filters.priceRange &&
      (filters.priceRange[0] > 0 || filters.priceRange[1] < 50000));

  return (
    <Box
      flex={1}
      backgroundColor="background"
      style={{ paddingTop: insets.top }}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader
        showBack={true}
        title={headerTitle}
        backgroundColor="cardBackground"
        headerRight={
          <Box flexDirection="row" alignItems="center">
            <IconButton
              icon="magnify"
              iconColor={theme.colors.textPrimary}
              size={24}
              onPress={() => router.push('/store/query')}
              style={{ margin: 0, marginRight: 4 }}
            />
            <Box>
              <IconButton
                icon="filter-variant"
                iconColor={theme.colors.textPrimary}
                size={24}
                onPress={handleFilterModalOpen}
                style={{ margin: 0 }}
              />
              {hasActiveFilters && (
                <Box
                  position="absolute"
                  top={8}
                  right={8}
                  width={8}
                  height={8}
                  borderRadius="full"
                  backgroundColor="error"
                />
              )}
            </Box>
          </Box>
        }
      />

      {isLoading ? (
        <Box padding="m" style={{ paddingTop: insets.top + 80 }}>
          <ScreenHeader title={screenTitle} />
          <Box flexDirection="row" justifyContent="space-between" marginTop="m">
            <Box style={{ width: '48%' }}>
              <ProductCardSkeleton height={200} />
              <ProductCardSkeleton height={280} />
            </Box>
            <Box style={{ width: '48%' }}>
              <ProductCardSkeleton height={260} />
              <ProductCardSkeleton height={190} />
            </Box>
          </Box>
        </Box>
      ) : (
        <Box flex={1} paddingHorizontal="s">
          <FlashList
            ref={listRef} // Conectamos la ref aquí
            data={products}
            masonry
            numColumns={2}
            optimizeItemArrangement={false}
            drawDistance={950}
            contentContainerStyle={{
              paddingTop: insets.top + 80,
              paddingBottom: 100,
            }}
            ListHeaderComponent={
              <Box marginBottom="m" paddingHorizontal="xs">
                <ScreenHeader
                  title={screenTitle}
                  subtitle={`${products.length} resultados encontrados`}
                />

                <ResultsFilterBar
                  filters={filters}
                  onUpdate={handleBarUpdate}
                  category={category}
                />
              </Box>
            }
            renderItem={({ item, index }) => (
              <Box
                paddingHorizontal="s"
                paddingBottom="s"
                style={{ width: '100%' }}
              >
                <ProductCard
                  product={item}
                  onPress={handleProductPress}
                  imageHeight={getMasonryItemHeight(item.aspect_ratio)}
                  index={index}
                />
              </Box>
            )}
            onEndReached={() => {
              if (hasNextPage) fetchNextPage();
            }}
            onEndReachedThreshold={0.5}
            keyExtractor={(item) => item.id}
            ListFooterComponent={
              isFetchingNextPage ? (
                <Box padding="m" alignItems="center">
                  <ActivityIndicator color={theme.colors.primary} />
                </Box>
              ) : (
                <Box height={50} />
              )
            }
            ListEmptyComponent={
              <Box marginTop="xl">
                <EmptyState
                  icon="magnify-remove-outline"
                  title="Sin resultados"
                  message="No encontramos lo que buscas. Intenta ajustar tus filtros."
                />
              </Box>
            }
          />
        </Box>
      )}

      <FilterModal
        ref={filterModalRef}
        category={category}
        initialFilters={{
          priceRange: filters.priceRange || [0, 50000],
          conditions: filters.conditions || [],
          specs: filters.specs || {},
        }}
        onApply={handleModalApply}
      />
    </Box>
  );
}
