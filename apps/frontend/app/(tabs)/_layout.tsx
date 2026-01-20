import { router, Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Theme } from '../../core/theme';
import { useCartStore } from '../../core/store/useCartStore';
import { CartTabIcon } from '../../components/ui/CartTabIcon';

export default function TabsLayout() {
  const theme = useTheme<Theme>();

  // 2. Obtenemos los items del carrito para contar cuántos hay
  const cartItems = useCartStore((state) => state.items);
  const cartCount = cartItems.length;

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textSecondary,
          tabBarStyle: {
            backgroundColor: theme.colors.cardBackground,
            borderTopColor: theme.colors.cardBackground,
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

        {/* Placeholder Vender */}
        <Tabs.Screen
          name="sell"
          options={{
            title: 'Vender',
            //headerShown: false,
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
              // Prevenimos la navegación por defecto (que buscaría index dentro de tabs)
              e.preventDefault();
              // Navegamos a nuestra ruta modal externa
              router.push('/sell');
            },
          }}
        />

        <Tabs.Screen
          name="cart"
          options={{
            title: 'Carrito',
            // 1. ELIMINAMOS ESTAS LÍNEAS (La forma vieja):
            // tabBarBadge: cartCount > 0 ? cartCount : undefined,
            // tabBarBadgeStyle: { ... },

            // 2. USAMOS EL NUEVO COMPONENTE EN EL ICONO:
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
    </SafeAreaView>
  );
}
