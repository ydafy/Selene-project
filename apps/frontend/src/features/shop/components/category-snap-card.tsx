/**
 * @file features/shop/components/category-snap-card.tsx
 * @description Primera tarjeta del feed de Shop.
 * Presenta las 4 categorías reina en franjas horizontales con fondo de imagen.
 */

import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box, Text } from '@/shared/ui/base';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { Theme } from '@/shared/theme';

import gpuShop from '@/assets/images/shop/gpushop.jpg';
import cpuShop from '@/assets/images/shop/cpuShop.jpg';
import ramShop from '@/assets/images/shop/ramshop.jpg';
import moboShop from '@/assets/images/shop/moboShop.jpg';

const CATEGORIES = [
  {
    id: 'gpu',
    i18nKey: 'GPU',
    value: 'GPU',
    img: gpuShop,
  },
  {
    id: 'cpu',
    i18nKey: 'CPU',
    value: 'CPU',
    img: cpuShop,
  },
  {
    id: 'ram',
    i18nKey: 'RAM',
    value: 'RAM',
    img: ramShop,
  },
  {
    id: 'mobo',
    i18nKey: 'MOTHERBOARD',
    value: 'Motherboard',
    img: moboShop,
  },
];

const CategorySnapCardComponent = ({
  visibleHeight,
}: {
  visibleHeight: number;
}) => {
  const { t } = useTranslation('search');
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme<Theme>();

  return (
    <Box height={visibleHeight}>
      {CATEGORIES.map((cat, index) => (
        <Pressable
          key={cat.id}
          style={({ pressed }) => [
            styles.glassCard,
            {
              transform: [{ scale: pressed ? 0.99 : 1 }],
              borderColor: pressed
                ? theme.colors.primary
                : theme.colors.separator,
              // El color de fondo con opacidad ayuda al Blur a verse más denso
              backgroundColor: theme.colors.glassSurface,
            },
          ]}
          onPress={() => {
            router.push({
              pathname: '/store/showroom/[id]',
              params: { id: cat.id.toUpperCase() },
            });
          }}
        >
          {/* ImageBackground is deprecated in SDK 58: an absolute image sits behind the content. */}
          <Image
            source={cat.img}
            contentFit="cover"
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[theme.colors.scrimLight, theme.colors.scrimStrong]}
            style={StyleSheet.absoluteFill}
          />
          <Box
            flex={1}
            justifyContent="center"
            paddingHorizontal="xl"
            // Solo la primera tira baja para no quedar bajo la SearchBar
            style={{ paddingTop: index === 0 ? insets.top + 60 : 0 }}
          >
            <Text
              variant="header-xl"
              color="textPrimary"
              style={{ fontSize: 32 }}
            >
              {t(`categoriesList.${cat.i18nKey}`)}
            </Text>
            <Box
              width={40}
              height={2}
              backgroundColor="primary"
              marginTop="s"
            />
          </Box>
        </Pressable>
      ))}
    </Box>
  );
};

export const CategorySnapCard = React.memo(CategorySnapCardComponent);

const styles = StyleSheet.create({
  glassCard: {
    flex: 1,
  },
});
