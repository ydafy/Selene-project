import { ScrollView, RefreshControl } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Box } from '../../components/base';
import { ProductCard } from '../../components/features/product/ProductCard';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { ProductCardSkeleton } from '../../components/features/product/ProductCardSkeleton';

import { useProducts } from '../../core/hooks/useProducts';
import { useMasonryColumns } from '../../core/hooks/useMasonryColumns'; // <-- Hook Nuevo
import { getMasonryItemHeight } from '../../core/constants/layout'; // <-- Utilidad Nueva
import { Theme } from '../../core/theme';
import { Product } from '@selene/types';

export default function HomeScreen() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('common');
  const router = useRouter();

  const { data: products, isLoading, error, refetch } = useProducts();

  // Lógica de UI extraída a un hook
  const { leftColumn, rightColumn } = useMasonryColumns(products);

  const handleProductPress = (product: Product) => {
    router.push({
      pathname: '/product/[id]',
      params: { id: product.id },
    });
  };

  if (isLoading) {
    return (
      <Box flex={1} backgroundColor="background" padding="m">
        <ScreenHeader title={t('home.title')} subtitle={t('home.subtitle')} />

        {/* Layout Masonry Simulado para Skeletons */}
        <Box flexDirection="row" justifyContent="space-between">
          {/* Columna Izq */}
          <Box style={{ width: '48%' }}>
            <ProductCardSkeleton height={200} />
            <ProductCardSkeleton height={280} />
            <ProductCardSkeleton height={180} />
          </Box>
          {/* Columna Der */}
          <Box style={{ width: '48%' }}>
            <ProductCardSkeleton height={260} />
            <ProductCardSkeleton height={190} />
            <ProductCardSkeleton height={240} />
          </Box>
        </Box>
      </Box>
    );
  }

  if (error) {
    return <ErrorState message={error.message} onRetry={refetch} />;
  }

  return (
    <Box flex={1} backgroundColor="background">
      <ScrollView
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
        <ScreenHeader title={t('home.title')} subtitle={t('home.subtitle')} />

        {products && products.length === 0 ? (
          <Box marginTop="xl">
            <EmptyState
              icon="magnify-remove-outline"
              title={t('home.emptyList')}
              message="Intenta recargar o vuelve más tarde."
            />
          </Box>
        ) : (
          /* Layout Masonry Limpio */
          <Box flexDirection="row" justifyContent="space-between">
            {/* Columna Izquierda */}
            <Box style={{ width: '49%' }}>
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

            {/* Columna Derecha */}
            <Box style={{ width: '49%' }}>
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
        )}
      </ScrollView>
    </Box>
  );
}
