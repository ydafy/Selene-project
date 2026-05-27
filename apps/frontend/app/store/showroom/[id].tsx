/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @file app/store/showroom/[id].tsx
 * Versión 2.1: Showroom Editorial de Grado Industrial.
 * Optimizada para FlashList v2, sin saltos de scroll y con i18n completo.
 */

import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { Dimensions, StyleSheet, TouchableOpacity } from 'react-native';
import { IconButton } from 'react-native-paper';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BottomSheetModal } from '@gorhom/bottom-sheet';

import { Box, Text } from '../../../components/base';
import { GlobalHeader } from '../../../components/layout/GlobalHeader';
import { ProductCard } from '../../../components/features/product/ProductCard';
import { ProductCardSkeleton } from '../../../components/features/product/ProductCardSkeleton';
import { ResultsFilterBar } from '../../../components/features/search/filters/ResultsFilterBar';
import { ShowroomInsights } from '../../../components/features/shop/showroom/ShowroomInsights';
import {
  FilterModal,
  FilterState,
} from '../../../components/features/search/FilterModal';
import { SearchFilters } from '../../../components/features/search/hooks/useSearchProducts';
import { AppImage } from '../../../components/ui/AppImage';
import { EmptyState } from '../../../components/ui/EmptyState';
import { useSearchProducts } from '../../../components/features/search/hooks/useSearchProducts';
import { getMasonryItemHeight } from '../../../core/constants/layout';
import { Theme } from '../../../core/theme';
import { Product } from '@selene/types';

//Imagenes
import gpuHero from '../../../assets/images/shop/news/gpu/gpuHero2.webp';
import GPU_4060 from '../../../assets/images/shop/news/gpu/GPU_4060.webp';
import GPU_rx7800 from '../../../assets/images/shop/news/gpu/GPU_rx7800.webp';
import cpuHero from '../../../assets/images/shop/news/cpu/cpuHero.webp';
import ryzen_57600 from '../../../assets/images/shop/news/cpu/ryzen_57600.webp';
import inteli5_14600k from '../../../assets/images/shop/news/cpu/intel-core-i5-14600k.webp';
import ramHero from '../../../assets/images/shop/news/ram/ramHero.webp';
import ddr5_6000Mhz from '../../../assets/images/shop/news/ram/ddr5_6000Mhz.webp';
import ddr4Ram from '../../../assets/images/shop/news/ram/ddr4Ram.webp';
import moboHero from '../../../assets/images/shop/news/mobo/moboHero.webp';
import moboAtx from '../../../assets/images/shop/news/mobo/moboAtx.webp';
import micro_atxMobo from '../../../assets/images/shop/news/mobo/micro_atxMobo.webp';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_HEIGHT * 0.6;
const SHOWROOM_ANCHOR = HERO_HEIGHT + 380;

// Optimizamos FlashList para animaciones de Reanimated
const AnimatedFlashList = Animated.createAnimatedComponent(
  FlashList,
) as typeof FlashList;

// --- CONFIGURACIÓN DE CONTENIDO (EL "CMS" DE LA PANTALLA) ---
const SHOWROOM_DATA: Record<string, any> = {
  GPU: {
    title: 'Dominancia gráfica',
    subtitle: 'El corazón de tu setup profesional.',
    hero: gpuHero,
    news: [
      {
        id: '1',
        title: 'RTX 4060 la reyna',
        desc: 'La mejor relación calidad-precio en 1080p de todo el mercado. Fuentes: Hardware Unboxed (enero 2026)',
        img: GPU_4060,
        action: {
          type: 'SEARCH',
          payload: { query: 'RTX 4060', category: 'GPU' },
        },
      },
      {
        id: '2',
        title: 'RX 7800 XT',
        desc: 'La gráfica que más gamers están buscando en segunda mano en 2026, segun TechPowerUp, Reddit r/hardwareswap (tendencia 2026)',
        img: GPU_rx7800,
        action: {
          type: 'SEARCH',
          payload: { query: 'RX 7800 XT', category: 'GPU' },
        },
      },
    ],
  },
  CPU: {
    title: 'Rapidez sin límites',
    subtitle: 'El cerebro de tu PC.',
    hero: cpuHero,
    news: [
      {
        id: '1',
        title: 'Ryzen 5 7600',
        desc: 'El procesador que más vale la pena comprar en 2026, según Hardware Unboxed, “Best CPU for Gaming 2026”',
        img: ryzen_57600,
        action: {
          type: 'SEARCH',
          payload: { query: 'Ryzen 5 7600X', category: 'CPU' },
        },
      },
      {
        id: '2',
        title: 'Core i5-14600K',
        desc: 'Aún uno de los mejores procesadores para gaming del mercado, según Gamers Nexus (enero 2026)',
        img: inteli5_14600k,
        action: {
          type: 'SEARCH',
          payload: { query: 'i5-14600K', category: 'CPU' },
        },
      },
    ],
  },
  RAM: {
    title: 'Memoria temporal',
    subtitle: 'Multitarea fluida y latencia mínima.',
    hero: ramHero,
    news: [
      {
        id: '1',
        title: 'DDR5 6000MHz',
        desc: 'La velocidad dulce que da el mejor rendimiento en 2026, según Hardware Unboxed & Buildzoid',
        img: ddr5_6000Mhz,
        action: {
          type: 'SEARCH',
          payload: {
            category: 'RAM',
            specs: { speed: '6000 MHz' },
          },
        },
      },
      {
        id: '2',
        title: 'DDR4 en 2026?',
        desc: 'La memoria DDR4 sigue siendo una buena opción si estás actualizando componentes de un sistema existente, según digibuggy (2026)',
        img: ddr4Ram,
        action: {
          type: 'SEARCH',
          payload: {
            category: 'RAM',
            specs: { type: 'DDR4' },
          },
        },
      },
    ],
  },
  MOTHERBOARD: {
    title: 'El cuerpo de tu PC',
    subtitle: 'Conectividad y estabilidad total.',
    hero: moboHero,
    news: [
      {
        id: '1',
        title: 'Tamaño ATX',
        desc: 'Sigue siendo el formato más popular y con mayor cuota de mercado en 2026, según SkyQuest Technology 2026',
        img: moboAtx,
        action: {
          type: 'SEARCH',
          payload: {
            category: 'Motherboard',
            specs: { form_factor: 'ATX' },
          },
        },
      },
      {
        id: '2',
        title: 'Micro-ATX',
        desc: 'La mejor opción calidad-precio y la más vendida en el mercado usado, según Mordor Intelligence (2026)',
        img: micro_atxMobo,
        action: {
          type: 'SEARCH',
          payload: {
            category: 'Motherboard',
            specs: { form_factor: 'Micro-ATX' },
          },
        },
      },
    ],
  },
};

export default function ShowroomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['search', 'home']);

  const listRef = useRef<FlashListRef<any>>(null);
  const filterModalRef = useRef<BottomSheetModal>(null);

  // 1. CONFIGURACIÓN DE CONTENIDO
  const categoryKey =
    id?.toUpperCase() === 'MOBO' ? 'MOTHERBOARD' : id?.toUpperCase() || 'GPU';
  const content = SHOWROOM_DATA[categoryKey] || SHOWROOM_DATA.GPU;

  // 2. ESTADO Y DATA
  const [filters, setFilters] = useState<SearchFilters>({
    category: id === 'MOBO' ? 'Motherboard' : id,
    orderBy: 'newest',
    verifiedOnly: false,
  });

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

  // Data híbrida para mostrar Skeletons sin desmontar la lista
  const displayData = useMemo(() => {
    // Si está cargando o RE-frescando y no hay productos, mostramos skeletons
    if ((isLoading || isRefetching) && products.length === 0) {
      return Array(6).fill({ isSkeleton: true });
    }
    return products;
  }, [isLoading, isRefetching, products]);

  // 3. HANDLERS MEMOIZADOS
  const handleBarUpdate = useCallback((newPart: Partial<SearchFilters>) => {
    setFilters((prev) => ({ ...prev, ...newPart }));
  }, []);

  const handleModalApply = useCallback((modalFilters: FilterState) => {
    setFilters((prev) => ({
      ...prev,
      priceRange: modalFilters.priceRange,
      conditions: modalFilters.conditions,
      specs: modalFilters.specs,
    }));
  }, []);

  const renderItem = useCallback(
    ({
      item,
      index,
    }: {
      item: Product | { isSkeleton: boolean };
      index: number;
    }) => {
      const isSkeleton = 'isSkeleton' in item && item.isSkeleton;
      if (isSkeleton) {
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
      const product = item as Product;
      return (
        <Box paddingHorizontal="s" paddingBottom="s">
          <ProductCard
            product={product}
            onPress={() =>
              router.push({
                pathname: '/product/[id]',
                params: { id: product.id },
              })
            }
            imageHeight={getMasonryItemHeight(product.aspect_ratio)}
            index={index}
          />
        </Box>
      );
    },
    [router],
  );

  // 4. ANIMACIONES DE SCROLL
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [HERO_HEIGHT - 150, HERO_HEIGHT - 60],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  const backButtonAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 100], [1, 0], Extrapolation.CLAMP),
  }));

  useEffect(() => {
    // Usamos requestAnimationFrame para esperar a que el motor de renderizado esté listo
    const scrollTask = requestAnimationFrame(() => {
      if (listRef.current) {
        // Ejecutamos el scroll al ancla
        listRef.current.scrollToOffset({
          offset: SHOWROOM_ANCHOR,
          animated: true,
        });
      }
    });

    return () => cancelAnimationFrame(scrollTask);
  }, [filters]); // Se dispara al cambiar cualquier filtro

  // --- LÓGICA DE FILTROS ACTIVOS (Versión Blindada) ---
  const hasActiveFilters = useMemo(() => {
    // 1. Desestructuramos con valores por defecto para evitar 'undefined'
    const { priceRange = [0, 50000], conditions = [], specs = {} } = filters;

    // 2. Verificamos Precio (¿Es diferente al rango inicial?)
    const isPriceActive = priceRange[0] > 0 || priceRange[1] < 50000;

    // 3. Verificamos Condiciones (¿Hay algún chip seleccionado?)
    const hasConditions = conditions.length > 0;

    // 4. Verificamos Specs (¿Alguna llave del JSONB tiene valores?)
    // Usamos Object.values para ver si hay arrays con contenido
    const hasSpecs = Object.values(specs).some(
      (val) => Array.isArray(val) && val.length > 0,
    );

    return isPriceActive || hasConditions || hasSpecs;
  }, [filters]);

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* BOTÓN ATRÁS FLOTANTE */}
      <Animated.View
        style={[
          backButtonAnimatedStyle,
          styles.floatingBack,
          { top: insets.top + 10 },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()}>
          <Box
            borderRadius="full"
            overflow="hidden"
            borderWidth={0.5}
            borderColor="separator"
          >
            <BlurView intensity={60} tint="dark" style={{ padding: 10 }}>
              <MaterialCommunityIcons
                name="arrow-left"
                size={24}
                color="white"
              />
            </BlurView>
          </Box>
        </TouchableOpacity>
      </Animated.View>

      {/* HEADER DINÁMICO */}
      <Animated.View style={[headerAnimatedStyle, styles.stickyHeader]}>
        <GlobalHeader
          showBack
          title={id?.toUpperCase()}
          backgroundColor="cardBackground"
          headerRight={
            <Box flexDirection="row" alignItems="center">
              <IconButton
                icon="magnify"
                iconColor={theme.colors.textPrimary}
                size={24}
                style={{ margin: 0 }}
                onPress={() =>
                  router.push({
                    pathname: '/store/query',
                  })
                }
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
      </Animated.View>

      <AnimatedFlashList
        ref={listRef}
        data={displayData as any}
        keyExtractor={(item: any, index: number) =>
          item.isSkeleton ? `skel-${index}` : item.id
        }
        renderItem={renderItem}
        maintainVisibleContentPosition={{
          disabled: true,
        }}
        masonry
        numColumns={2}
        onScroll={scrollHandler}
        drawDistance={500}
        contentContainerStyle={{ paddingBottom: 100 }}
        onEndReached={() => {
          if (hasNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.8}
        ListHeaderComponent={
          <Box>
            {/* HERO EDITORIAL */}
            <Box height={HERO_HEIGHT} width="100%">
              <AppImage
                source={content.hero}
                memoryKey={`hero-${categoryKey}`}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                priority="high"
              />
              <LinearGradient
                colors={[
                  'rgba(255,255,255,0.03)',
                  'transparent',
                  theme.colors.background,
                ]}
                style={StyleSheet.absoluteFill}
                locations={[0, 0.3, 1]}
              />
            </Box>

            <Box padding="m" gap="xs" marginTop="s" alignItems="center">
              <Text variant="header-2xl" color="textPrimary">
                {content.title}
              </Text>
              <Text
                variant="body-lg"
                color="primary"
                style={{ fontStyle: 'italic', opacity: 0.9 }}
              >
                {content.subtitle}
              </Text>
            </Box>

            {/* SECCIÓN NOTICIAS */}
            <Box padding="m">
              <Text variant="header-xl" color="primary">
                {t('home:editorial.title')}
              </Text>
            </Box>
            <ShowroomInsights news={content.news} />

            {/* SECCIÓN CATÁLOGO */}
            <Box padding="m" marginTop="l">
              <Text variant="header-xl" color="primary">
                {id?.toUpperCase()}'S EN SELENE
              </Text>
            </Box>
            <Box paddingHorizontal="s" paddingBottom="m">
              <ResultsFilterBar
                filters={filters}
                onUpdate={handleBarUpdate}
                category={filters.category}
              />
            </Box>
          </Box>
        }
        ListEmptyComponent={
          <Box padding="xl" alignItems="center" marginTop="xl">
            <EmptyState
              icon="magnify-remove-outline"
              title="Sin coincidencias"
              message="Intenta con otros criterios."
            />
          </Box>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <Box flexDirection="row" justifyContent="space-between" padding="s">
              <Box width="48%">
                <ProductCardSkeleton height={200} />
              </Box>
              <Box width="48%">
                <ProductCardSkeleton height={250} />
              </Box>
            </Box>
          ) : (
            <Box height={20} />
          )
        }
      />

      <FilterModal
        ref={filterModalRef}
        category={filters.category}
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

const styles = StyleSheet.create({
  floatingBack: { position: 'absolute', left: 16, zIndex: 110 },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
});
