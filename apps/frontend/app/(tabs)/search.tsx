/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useMemo, useCallback } from 'react';
import { FlatList, Dimensions, Platform, TouchableOpacity } from 'react-native';

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
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();
  const router = useRouter();
  const listRef = useRef<FlatList>(null);

  const {
    data: products,
    isLoading,
    error,
  } = useProducts({
    verifiedOnly: true,
    limit: 10,
  });

  const [activeId, setActiveId] = useState('categories');

  const viewConfigRef = useRef({ viewAreaCoveragePercentThreshold: 80 });
  const onViewRef = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActiveId(viewableItems[0].item.id);
    }
  });

  const TAB_BAR_APPROX = Platform.OS === 'ios' ? 88 : 60;
  const VISIBLE_HEIGHT = SCREEN_HEIGHT - TAB_BAR_APPROX;

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

      switch (item.type) {
        case 'CATEGORIES':
          return <CategorySnapCard visibleHeight={VISIBLE_HEIGHT} />;
        case 'BRANDS':
          return <BrandSnapCard visibleHeight={VISIBLE_HEIGHT} />;
        case 'TRUST':
          return (
            <ShellTrustSnap
              visibleHeight={VISIBLE_HEIGHT}
              isActive={isActive}
            />
          );
        case 'PRODUCT':
          return (
            <ProductSnapCard
              product={item.data}
              visibleHeight={VISIBLE_HEIGHT}
            />
          );
        case 'END_FEED':
          return (
            <ShellEndFeedCard2
              visibleHeight={VISIBLE_HEIGHT}
              isActive={activeId === item.id}
            />
          );
        default:
          return null;
      }
    },
    [activeId, VISIBLE_HEIGHT],
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
        <ShopSkeleton visibleHeight={VISIBLE_HEIGHT} />
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
            // --- CONFIGURACIÓN DE SNAP ---
            pagingEnabled
            // VITAL: Le dice a FlashList el alto exacto
            showsVerticalScrollIndicator={false}
            snapToInterval={VISIBLE_HEIGHT}
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
