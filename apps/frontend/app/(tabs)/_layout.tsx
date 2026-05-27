import { router, Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Theme } from '../../core/theme';
import { useCartStore } from '../../core/store/useCartStore';
import { CartTabIcon } from '../../components/ui/CartTabIcon';
import { Box } from '@/components/base';
import { Platform } from 'react-native';

export default function TabsLayout() {
  const theme = useTheme<Theme>();

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
            backgroundColor: theme.colors.cardBackground,
            borderTopColor: theme.colors.cardBackground,
            height: Platform.OS === 'ios' ? 80 : 60,
            paddingBottom: Platform.OS === 'ios' ? 20 : 10,
          },
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Inicio',
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
            title: 'Buscar',
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
            title: 'Vender',
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
            title: 'Carrito',
            tabBarIcon: ({ color, size }) => (
              <CartTabIcon color={color} size={size} count={cartCount} />
            ),
          }}
        />

        <Tabs.Screen
          name="profile"
          options={{
            title: 'Perfil',
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
