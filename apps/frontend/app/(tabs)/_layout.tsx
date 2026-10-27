import { router, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Theme } from '../../core/theme';
import { useCartStore } from '../../core/store/useCartStore';
import { CartTabIcon } from '../../components/ui/CartTabIcon';
import { Box } from '@/components/base';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { getTabDockMetrics, TAB_DOCK } from '../../core/constants/layout';

export default function TabsLayout() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  const dockMetrics = getTabDockMetrics(insets.bottom);

  // Estado del Carrito
  const cartItems = useCartStore((state) => state.items);
  const cartCount = cartItems.length;

  return (
    <Box flex={1} backgroundColor="background">
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textPrimary,
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: theme.colors.cardBackground,
            borderTopWidth: 0,

            left: TAB_DOCK.sideGutter,
            right: TAB_DOCK.sideGutter,
            bottom: dockMetrics.bottomSeparation,

            height: TAB_DOCK.height,
            borderRadius: TAB_DOCK.borderRadius,
            marginHorizontal: theme.spacing.m,

            elevation: 8,
            shadowColor: theme.colors.shadow,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 5,
          },
          tabBarItemStyle: {
            minHeight: 44,
          },
          tabBarIconStyle: {
            transform: [{ translateY: TAB_DOCK.contentOffsetY }],
          },

          tabBarLabelStyle: {
            transform: [{ translateY: TAB_DOCK.contentOffsetY }],
          },
          tabBarBackground: () => (
            <LinearGradient
              colors={['transparent', theme.colors.background]}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: -TAB_DOCK.sideGutter,
                right: -TAB_DOCK.sideGutter,
                bottom: -dockMetrics.bottomSeparation,
                height:
                  TAB_DOCK.height +
                  TAB_DOCK.gradientHeight +
                  dockMetrics.bottomSeparation,
              }}
            />
          ),
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.home'),
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons
                name="home-outline"
                color={color}
                size={size}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="search"
          options={{
            title: t('tabs.search'),

            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons
                name="magnify"
                color={color}
                size={size}
              />
            ),
          }}
        />

        <Tabs.Screen
          name="sell"
          options={{
            title: t('tabs.sell'),
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons
                name="plus-circle-outline"
                color={color}
                size={size}
              />
            ),
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              router.push('/sell');
            },
          }}
        />

        <Tabs.Screen
          name="cart"
          options={{
            title: t('tabs.cart'),
            tabBarIcon: ({ color, size }) => (
              <CartTabIcon color={color} size={size} count={cartCount} />
            ),
          }}
        />

        <Tabs.Screen
          name="profile"
          options={{
            title: t('tabs.profile'),
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons
                name="account-outline"
                color={color}
                size={size}
              />
            ),
          }}
        />
      </Tabs>
    </Box>
  );
}
