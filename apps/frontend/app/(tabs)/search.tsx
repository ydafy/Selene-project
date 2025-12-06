import { useRef } from 'react';
import { ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
// Eliminamos useSafeAreaInsets porque ya lo maneja el _layout global

import { Box, Text } from '../../components/base';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { CategoryCard } from '../../components/features/search/CategoryCard';
import { SearchBar } from '../../components/ui/SearchBar';
import { ProductCard } from '../../components/features/product/ProductCard';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProductCardSkeleton } from '../../components/features/product/ProductCardSkeleton';

import { useProducts } from '../../core/hooks/useProducts';
import { useMasonryColumns } from '../../core/hooks/useMasonryColumns';
import { getMasonryItemHeight } from '../../core/constants/layout';
import { Theme } from '../../core/theme';
import { Product } from '@selene/types';

export default function SearchScreen() {
  const { t } = useTranslation(['search', 'common']);

  const router = useRouter();
  const theme = useTheme<Theme>();

  const scrollRef = useRef<ScrollView>(null);

  const { data: products, isLoading, refetch } = useProducts();
  const limitedProducts = products?.slice(0, 20);

  const { leftColumn, rightColumn } = useMasonryColumns(limitedProducts);

  const handleProductPress = (product: Product) => {
    router.push({
      pathname: '/product/[id]',
      params: { id: product.id },
    });
  };

  const handleCategoryPress = (category: string) => {
    router.push({
      pathname: '/store/results',
      params: { category },
    });
  };

  const handleSearchPress = () => {
    router.push({
      pathname: '/store/query',
    });
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  return (
    // CORRECCIÓN: Quitamos el style={{ paddingTop: insets.top }}
    <Box flex={1} backgroundColor="background">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          padding: theme.spacing.m,
          paddingBottom: 100,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* --- HEADER Y BÚSQUEDA --- */}
        <ScreenHeader title={t('title')} />

        <Box marginBottom="l">
          <SearchBar
            placeholder={t('placeholder')}
            readOnly
            onPress={handleSearchPress}
          />
        </Box>

        {/* --- CATEGORÍAS --- */}
        <Text variant="subheader-lg" marginBottom="m" color="primary">
          {t('categories')}
        </Text>

        <Box
          flexDirection="row"
          flexWrap="wrap"
          justifyContent="space-between"
          marginBottom="l"
        >
          <CategoryCard
            label="GPU"
            icon="expansion-card-variant"
            color="primary"
            onPress={() => handleCategoryPress('GPU')}
          />
          <CategoryCard
            label="CPU"
            icon="cpu-64-bit"
            color="primary"
            onPress={() => handleCategoryPress('CPU')}
          />
          <CategoryCard
            label="Motherboard"
            icon="developer-board"
            color="primary"
            onPress={() => handleCategoryPress('Motherboard')}
          />
          <CategoryCard
            label="RAM"
            icon="memory"
            color="primary"
            onPress={() => handleCategoryPress('RAM')}
          />
        </Box>

        {/* --- FEED DE EXPLORACIÓN (MASONRY) --- */}
        <Text variant="subheader-lg" marginBottom="m" color="primary">
          {t('exploreSection')}
        </Text>

        {isLoading ? (
          <Box flexDirection="row" justifyContent="space-between">
            <Box style={{ width: '48%' }}>
              <ProductCardSkeleton height={200} />
              <ProductCardSkeleton height={280} />
            </Box>
            <Box style={{ width: '48%' }}>
              <ProductCardSkeleton height={260} />
              <ProductCardSkeleton height={190} />
            </Box>
          </Box>
        ) : (
          <>
            {limitedProducts && limitedProducts.length > 0 ? (
              <Box flexDirection="row" justifyContent="space-between">
                <Box style={{ width: '48%' }}>
                  {leftColumn.map((item, index) => (
                    <ProductCard
                      key={item.id}
                      product={item}
                      onPress={handleProductPress}
                      imageHeight={getMasonryItemHeight(item.aspect_ratio)}
                      index={index}
                    />
                  ))}
                </Box>

                <Box style={{ width: '48%' }}>
                  {rightColumn.map((item, index) => (
                    <ProductCard
                      key={item.id}
                      product={item}
                      onPress={handleProductPress}
                      imageHeight={getMasonryItemHeight(item.aspect_ratio)}
                      index={index}
                    />
                  ))}
                </Box>
              </Box>
            ) : (
              <EmptyState
                icon="magnify"
                title="Sin resultados"
                message="No hay productos recientes para mostrar."
              />
            )}

            {limitedProducts && limitedProducts.length > 10 && (
              <Box marginTop="xl" alignItems="center">
                <PrimaryButton
                  onPress={scrollToTop}
                  variant="outline"
                  icon="arrow-up"
                  style={{ width: 200 }}
                >
                  {t('backToTop')}
                </PrimaryButton>
              </Box>
            )}
          </>
        )}
      </ScrollView>
    </Box>
  );
}
