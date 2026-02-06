import { ScrollView, RefreshControl } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';

import { Box } from '../../components/base';
import { ProductCard } from '../../components/features/product/ProductCard';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { ProductCardSkeleton } from '../../components/features/product/ProductCardSkeleton';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { LocationHeaderButton } from '../../components/features/address/LocationHeaderButton';
import { AddressPickerModal } from '../../components/features/address/AddressPickerModal';

import { useCheckoutStore } from '../../core/store/useCheckoutStore'; // <--- 1. IMPORTAR STORE
import { useAddresses } from '../../core/hooks/useAddresses'; // <--- 2. IMPORTAR HOOK

import { useProducts } from '../../core/hooks/useProducts';
import { useMasonryColumns } from '../../core/hooks/useMasonryColumns';
import { getMasonryItemHeight } from '../../core/constants/layout';
import { Theme } from '../../core/theme';
import { Address, Product } from '@selene/types';
import { useRef } from 'react';
import { IconButton } from 'react-native-paper';

export default function HomeScreen() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('common');
  const router = useRouter();

  const { data: products, isLoading, error, refetch } = useProducts();
  const addressModalRef = useRef<BottomSheetModal>(null);
  // Lógica de UI extraída a un hook
  const { leftColumn, rightColumn } = useMasonryColumns(products);

  const { setSelectedAddress } = useCheckoutStore();
  const { setDefault } = useAddresses();

  const handleOpenAddressPicker = () => {
    addressModalRef.current?.present();
  };

  const handleGoToFavorites = () => {
    console.log('Navegar a Favoritos');
  };

  const handleProductPress = (product: Product) => {
    router.push({
      pathname: '/product/[id]',
      params: { id: product.id },
    });
  };

  const handleAddressChange = (address: Address) => {
    // A. Actualizamos la Base de Datos (Para que el Header del Home cambie)
    setDefault(address.id);

    // B. Actualizamos el Store del Checkout (Para que el Carrito sepa a dónde enviar)
    setSelectedAddress(address);

    // C. Cerramos el modal (aunque el componente lo hace, es bueno ser explícito si cambiamos lógica)
    addressModalRef.current?.dismiss();
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
      <GlobalHeader
        titleComponent={
          <LocationHeaderButton onPress={handleOpenAddressPicker} />
        }
        alignTitle="flex-start"
        // LA SOLUCIÓN:
        useSafeArea={false}
        headerRight={
          <IconButton
            icon="heart-outline"
            iconColor={theme.colors.textPrimary}
            size={24}
            onPress={handleGoToFavorites}
            style={{ margin: 0 }}
          />
        }
      />
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.m,
          paddingBottom: 100,
          paddingTop: 80,
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
      <AddressPickerModal
        innerRef={addressModalRef}
        onSelect={handleAddressChange}
      />
    </Box>
  );
}
