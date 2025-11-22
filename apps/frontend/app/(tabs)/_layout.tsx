import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

/**
 * Este es el layout para el grupo de rutas principal de la app.
 * Define el Bottom Tab Navigator.
 */
export default function TabsLayout() {
  const theme = useTheme<Theme>();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary, // Color del icono activo ('lion')
        tabBarInactiveTintColor: theme.colors.textPrimary, // Color del icono inactivo
        tabBarStyle: {
          backgroundColor: theme.colors.background, // Color de fondo de la barra
          borderTopColor: theme.colors.cardBackground,
        },
        headerShown: false, // Ocultamos el header por defecto para todas las pestañas
      }}
    >
      <Tabs.Screen
        name="index" // Esto enlaza al archivo app/(tabs)/index.tsx
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
            <MaterialCommunityIcons name="magnify" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="cart"
        options={{
          title: 'Carrito',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="cart-outline"
              color={color}
              size={size}
            />
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
  );
}
