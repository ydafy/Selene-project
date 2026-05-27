/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @file app/store/results.tsx
 * Versión 2.0: Optimización de flujo de carga y anclaje de filtros.
 */

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
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

const RESULTS_ANCHOR = 0; // Punto donde el header desaparece y los filtros quedan arriba

export default function SearchResultsScreen() {
  const FlashListV2 = FlashList as any;
  const rawParams = useLocalSearchParams();
  const category = rawParams.category as string | undefined;
  const query = rawParams.query as string | undefined;
  const specsRaw = rawParams.specs as string | undefined;
  const specs = useMemo(() => {
    if (!specsRaw) return {};
    // Si ya es un objeto (porque useLocalSearchParams lo parseó), lo devolvemos
    if (typeof specsRaw === 'object') return specsRaw;
    // Si es un string (JSON), lo parseamos
    try {
      return JSON.parse(decodeURIComponent(specsRaw));
    } catch {
      return {};
    }
  }, [specsRaw]);
  const theme = useTheme<Theme>();
  const { t } = useTranslation(['search', 'common']);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const filterModalRef = useRef<BottomSheetModal>(null);
  const listRef = useRef<FlashListRef<Product> | null>(null);

  const [filters, setFilters] = useState<SearchFilters>({
    query: query || '',
    category: category || undefined,
    priceRange: [0, 50000],
    conditions: [],
    specs: specs || {},
    orderBy: 'newest',
    verifiedOnly: false,
  });

  // Sincronizar filtros cuando cambia la URL
  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      query: query || '',
      category: category || undefined,
      specs: specs || {},
    }));
  }, [query, category, specsRaw]);

  const {
    data,
    isLoading,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSearchProducts(filters);
  const products = useMemo(
    () => data?.pages.flatMap((page) => page.data) || [],
    [data],
  );

  // --- 1. LÓGICA DE DATA HÍBRIDA (Evita el desmontaje) ---
  const displayData = useMemo(() => {
    // Si está cargando (inicial o por filtro) y no hay productos previos, mostramos skeletons
    if ((isLoading || isRefetching) && products.length === 0) {
      return Array(6).fill({ isSkeleton: true });
    }
    return products;
  }, [isLoading, isRefetching, products]);

  // --- 2. ANCLAJE DE SCROLL QUIRÚRGICO ---
  useEffect(() => {
    const scrollTask = requestAnimationFrame(() => {
      if (listRef.current && displayData.length > 0) {
        listRef.current.scrollToOffset({
          offset: RESULTS_ANCHOR,
          animated: true,
        });
      }
    });
    return () => cancelAnimationFrame(scrollTask);
  }, [filters]);

  const handleProductPress = useCallback(
    (product: Product) => {
      router.push(`/product/${product.id}` as any);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item, index }: any) => {
      if (item.isSkeleton) {
        return (
          <Box
            paddingHorizontal="s"
            paddingBottom="s"
            style={{ width: '100%' }}
          >
            <ProductCardSkeleton height={200 + (index % 2) * 40} />
          </Box>
        );
      }
      return (
        <Box paddingHorizontal="s" paddingBottom="s" style={{ width: '100%' }}>
          <ProductCard
            product={item}
            onPress={handleProductPress}
            imageHeight={getMasonryItemHeight(item.aspect_ratio)}
            index={index}
          />
        </Box>
      );
    },
    [handleProductPress],
  );

  const getItemType = useCallback(
    (item: any) => (item.isSkeleton ? 'skeleton' : 'product'),
    [],
  );

  const handleBarUpdate = useCallback((newPart: Partial<SearchFilters>) => {
    setFilters((prev) => ({ ...prev, ...newPart }));
  }, []);

  const handleModalApply = useCallback((modalFilters: FilterState) => {
    setFilters((prev) => ({ ...prev, ...modalFilters }));
  }, []);

  const screenTitle = useMemo(() => {
    const resultsLabel = t('search:resultsTitle');

    // 1. Intentamos obtener el término de búsqueda
    // Si no hay 'query' (texto), buscamos el primer valor de 'specs' (ej: "6000 MHz")
    const firstSpecValue = filters.specs
      ? Object.values(filters.specs).flat()[0]
      : null;
    const activeSearchTerm = query || firstSpecValue;

    // Caso A: Categoría + Algún filtro (Texto o Spec)
    if (category && activeSearchTerm) {
      return `${category}: ${activeSearchTerm}`;
    }

    // Caso B: Solo categoría
    if (category) {
      return `${resultsLabel}: ${category}`;
    }

    // Caso C: Solo búsqueda de texto
    if (query) {
      return `"${query}"`;
    }

    // Caso D: Catálogo General
    return resultsLabel;
  }, [category, query, filters.specs, t]);

  // El título del header superior (más corto)
  const headerTitle = query || category || t('search:resultsTitle');

  const hasActiveFilters = useMemo(() => {
    //  Desestructuramos con valores por defecto para evitar 'undefined'
    const { priceRange = [0, 50000], conditions = [], specs = {} } = filters;

    // Verificamos Precio (¿Es diferente al rango inicial?)
    const isPriceActive = priceRange[0] > 0 || priceRange[1] < 50000;

    // Verificamos Condiciones (¿Hay algún chip seleccionado?)
    const hasConditions = conditions.length > 0;

    // Verificamos Specs (¿Alguna llave del JSONB tiene valores?)
    // Usamos Object.values para ver si hay arrays con contenido
    const hasSpecs = Object.values(specs).some(
      (val) => Array.isArray(val) && val.length > 0,
    );

    return isPriceActive || hasConditions || hasSpecs;
  }, [filters]);

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      <GlobalHeader
        showBack
        title={headerTitle}
        backgroundColor="cardBackground"
        headerRight={
          <Box flexDirection="row" alignItems="center">
            <IconButton
              icon="magnify"
              iconColor={theme.colors.textPrimary}
              size={24}
              style={{ margin: 0 }}
              onPress={() => router.push('/store/query' as any)}
            />
            <IconButton
              icon="filter-variant"
              iconColor={theme.colors.textPrimary}
              size={24}
              style={{ margin: 0 }}
              onPress={() => filterModalRef.current?.present()}
            />
            {hasActiveFilters && (
              <Box
                position="absolute"
                top={6}
                right={6}
                width={10}
                height={10}
                borderRadius="full"
                backgroundColor="error" // Tu color rojo del tema
                borderWidth={2}
                borderColor="cardBackground" // Crea el efecto de recorte pro
              />
            )}
          </Box>
        }
      />

      <Box flex={1} paddingHorizontal="s">
        <FlashListV2
          ref={listRef}
          data={displayData}
          getItemType={getItemType}
          renderItem={renderItem}
          keyExtractor={(item: any, index: number) =>
            item.isSkeleton ? `skel-${index}` : item.id
          }
          masonry
          numColumns={2}
          estimatedItemSize={260}
          drawDistance={500}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.8}
          maintainVisibleContentPosition={null}
          contentContainerStyle={{
            paddingTop: insets.top + 80,
            paddingBottom: 100,
          }}
          ListHeaderComponent={
            <Box marginBottom="m" paddingHorizontal="xs">
              <ScreenHeader
                title={screenTitle}
                subtitle={`${products.length} ${t('search:resultsFound')}`}
              />
              <ResultsFilterBar
                filters={filters}
                onUpdate={handleBarUpdate}
                category={category}
              />
            </Box>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <Box
                flexDirection="row"
                justifyContent="space-between"
                paddingHorizontal="s"
              >
                <Box style={{ width: '48%' }}>
                  <ProductCardSkeleton height={200} />
                </Box>
                <Box style={{ width: '48%' }}>
                  <ProductCardSkeleton height={240} />
                </Box>
              </Box>
            ) : (
              <Box height={50} />
            )
          }
          ListEmptyComponent={
            !isLoading && !isRefetching ? (
              <Box marginTop="xl">
                <EmptyState
                  icon="magnify-remove-outline"
                  title={t('common:states.feedEmpty')}
                  message={t('common:states.feedEmptyMessage')}
                />
              </Box>
            ) : null
          }
        />
      </Box>

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
