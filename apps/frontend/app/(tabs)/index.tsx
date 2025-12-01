import { FlatList } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../components/base';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProductCard } from '../../components/features/product/ProductCard';
import { useProducts } from '../../core/hooks/useProducts';
import { Theme } from '../../core/theme';
import { Product } from '@selene/types';
import { ProductCardSkeleton } from '@/components/features/product/ProductCardSkeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlobalHeader } from '@/components/layout/GlobalHeader';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { useAuthContext } from '../../components/auth/AuthProvider'; // <-- Importar Contexto Auth
import { useAuthModal } from '../../core/auth/AuthModalProvider'; // <-- Importar Contexto Modal
import { useEffect } from 'react';

export default function HomeScreen() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation(['common', 'product']);
  const insets = useSafeAreaInsets();

  const { session, loading: authLoading } = useAuthContext();
  const { present } = useAuthModal();

  const { data: products, isLoading, error, refetch } = useProducts();

  const handleProductPress = (product: Product) => {
    router.push({
      pathname: '/product/[id]',
      params: { id: product.id },
    });
  };

  useEffect(() => {
    // Si ya terminó de cargar la sesión Y no hay usuario...
    if (!authLoading && !session) {
      // ...esperamos 1.5 segundos y mostramos el modal
      const timer = setTimeout(() => {
        present('login');
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [authLoading, session]); // Se ejecuta cuando cambia el estado de la sesión

  // --- ESTADO DE CARGA (Skeletons) ---
  if (isLoading) {
    return (
      <Box flex={1} backgroundColor="background" padding="m">
        {/* Header Falso para evitar saltos de layout visuales */}
        <Box marginBottom="l">
          <Text variant="header-xl">{t('product:feed.title')}</Text>
          <Text variant="body-md" color="textSecondary">
            {t('product:feed.subtitle')}
          </Text>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </Box>
      </Box>
    );
  }

  // --- ESTADO DE ERROR ---
  if (error) {
    return (
      <ErrorState
        message={error.message}
        onRetry={refetch} // React Query nos da la función refetch
      />
    );
  }

  // --- LISTA DE PRODUCTOS ---
  return (
    <Box
      flex={1}
      backgroundColor="background"
      style={{ paddingTop: insets.top }}
    >
      <GlobalHeader
        showBack={true}
        title={t('product.detailsTitle')}
        //rightIcon="heart-outline"
        //onRightPress={() => console.log('Fav')}
      />
      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          // flex={0.5} asegura que ocupe la mitad del ancho en 2 columnas
          <Box flex={0.5} paddingHorizontal="s">
            <ProductCard product={item} onPress={handleProductPress} />
          </Box>
        )}
        numColumns={2}
        contentContainerStyle={{
          padding: theme.spacing.m,

          paddingBottom: 80 + insets.bottom + 20,
        }}
        columnWrapperStyle={{
          justifyContent: 'space-between',
        }}
        onRefresh={refetch}
        refreshing={isLoading}
        // Header real
        ListHeaderComponent={
          <ScreenHeader title={t('home.title')} subtitle={t('home.subtitle')} />
        }
        // Estado vacío
        ListEmptyComponent={
          <EmptyState
            title={t('home.emptyList')}
            message="Intenta ajustar tus filtros o busca otra cosa."
            icon="magnify-remove-outline"
          />
        }
      />
    </Box>
  );
}
