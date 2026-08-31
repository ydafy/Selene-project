/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useMemo, useCallback } from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useScrollToTop } from '@react-navigation/native';
import { MotiView } from 'moti';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';

import { Box, Text } from '../../components/base';
import {
  CategorySnapCard,
  BrandSnapCard,
  ShellTrustSnap,
} from '../../components/features/shop/index';
import { ShopSkeleton } from '../../components/features/shop/ShopSkeleton';
import { useProducts } from '../../core/hooks/useProducts';
import { Theme } from '../../core/theme/index';
import { useTheme } from '@shopify/restyle';
import { ProductSnapCard } from '../../components/features/shop/sections/ProductSnapCard';

import { ShellEndFeedCard2 } from '@/components/features/shop/sections/ShellEndFeedCard2';
import { getTabDockMetrics } from '../../core/constants/layout';

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { bottom } = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const theme = useTheme<Theme>();
  const router = useRouter();
  const listRef = useRef<FlatList>(null);

  const TAB_BAR_HEIGHT = 40;
  const PADDING_BOTTOM = TAB_BAR_HEIGHT + bottom + 12;

  const {
    data: products,
    isLoading,
    error,
  } = useProducts({
    verifiedOnly: true,
    limit: 10,
  });

  const [activeId, setActiveId] = useState('categories');
  const [pageHeight, setPageHeight] = useState(screenHeight);

  const viewConfigRef = useRef({ viewAreaCoveragePercentThreshold: 80 });
  const onViewRef = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActiveId(viewableItems[0].item.id);
    }
  });

  const dockMetrics = getTabDockMetrics(insets.bottom);
  const contentBottomClearance = dockMetrics.contentBottomClearance;
  const visibleHeight = pageHeight;

  const handleListLayout = useCallback(
    ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
      if (layout.height > 0 && layout.height !== pageHeight) {
        setPageHeight(layout.height);
      }
    },
    [pageHeight],
  );

  useScrollToTop(listRef);

  // DATA MEMOIZADA
  const feedData = useMemo(() => {
    const base = [
      { id: 'categories', type: 'CATEGORIES' },
      { id: 'brands', type: 'BRANDS' },
      { id: 'trust', type: 'TRUST' },
    ];
    const prods = (products || []).map((p) => ({
      id: `prod-${p.id}`,
      type: 'PRODUCT',
      data: p,
    }));
    return [...base, ...prods, { id: 'end-feed', type: 'END_FEED' }];
  }, [products]);

  //RENDERITEM ESTABLE
  const renderItem = useCallback(
    ({ item }: any) => {
      const isActive = activeId === item.id;

      let content;

      switch (item.type) {
        case 'CATEGORIES':
          content = <CategorySnapCard visibleHeight={visibleHeight} />;
          break;
        case 'BRANDS':
          content = <BrandSnapCard visibleHeight={visibleHeight} />;
          break;
        case 'TRUST':
          content = (
            <ShellTrustSnap
              visibleHeight={visibleHeight}
              isActive={isActive}
              contentBottomClearance={PADDING_BOTTOM}
            />
          );
          break;
        case 'PRODUCT':
          content = (
            <ProductSnapCard
              product={item.data}
              visibleHeight={visibleHeight}
              contentBottomClearance={PADDING_BOTTOM}
            />
          );
          break;
        case 'END_FEED':
          content = (
            <ShellEndFeedCard2
              visibleHeight={visibleHeight}
              isActive={activeId === item.id}
              contentBottomClearance={contentBottomClearance}
            />
          );
          break;
        default:
          return null;
      }

      return <Box height={pageHeight}>{content}</Box>;
    },
    [activeId, contentBottomClearance, pageHeight, visibleHeight],
  );

  return (
    <Box flex={1} backgroundColor="background">
      {/* --- CONTROL CENTER (Lupa + Catálogo) --- */}
      <Box
        position="absolute"
        top={insets.top + 10}
        right={16}
        zIndex={100}
        flexDirection="row"
        gap="s"
      >
        {/* 1. BOTÓN VER CATÁLOGO */}
        <TouchableOpacity
          onPress={() => router.push('/store/results' as any)}
          activeOpacity={0.7}
        >
          <Box
            borderRadius="full"
            overflow="hidden"
            borderWidth={0.5}
            borderColor="blurBackground"
          >
            <BlurView
              intensity={80}
              tint="dark"
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <MaterialCommunityIcons
                name="view-grid-outline"
                size={22}
                color={theme.colors.textPrimary}
              />
              {/* <Text
                variant="caption-md"
                color="textPrimary"
                fontWeight="bold"
                style={{ fontSize: 11, letterSpacing: 1 }}
              >
                VER CATÁLOGO
              </Text> */}
            </BlurView>
          </Box>
        </TouchableOpacity>

        {/* 2. BOTÓN BUSCAR (Lupa) */}
        <TouchableOpacity
          onPress={() => router.push('/store/query' as any)}
          activeOpacity={0.7}
        >
          <Box
            borderRadius="full"
            overflow="hidden"
            borderWidth={0.5}
            borderColor="blurBackground"
          >
            <BlurView intensity={80} tint="dark" style={{ padding: 10 }}>
              <MaterialCommunityIcons
                name="magnify"
                size={22}
                color={theme.colors.textPrimary}
              />
            </BlurView>
          </Box>
        </TouchableOpacity>
      </Box>

      {error ? (
        <Box flex={1} alignItems="center" justifyContent="center" padding="xl">
          <Text variant="body-lg" color="textSecondary">
            {error.message}
          </Text>
        </Box>
      ) : isLoading ? (
        <ShopSkeleton visibleHeight={visibleHeight} />
      ) : (
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 500 }}
          style={{ flex: 1 }}
        >
          <FlatList
            data={feedData}
            ref={listRef}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            onLayout={handleListLayout}
            // --- CONFIGURACIÓN DE SNAP ---
            pagingEnabled
            // VITAL: Le dice a FlashList el alto exacto
            showsVerticalScrollIndicator={false}
            snapToInterval={pageHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            bounces={false}
            // --- OPTIMIZACIÓN DE MEMORIA ---
            onViewableItemsChanged={onViewRef.current}
            viewabilityConfig={viewConfigRef.current}
          />
        </MotiView>
      )}
    </Box>
  );
}
