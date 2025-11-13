import { ThemeProvider } from '@shopify/restyle';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import '../core/i18n'; // Importa la configuración de i18n

import { paperTheme, theme } from '../core/theme';

// Creamos una instancia del cliente de React Query
const queryClient = new QueryClient();

/**
 * RootLayout es el componente principal que envuelve toda la aplicación.
 * Aquí es donde configuramos todos los proveedores globales (Tema, Datos, etc.)
 * y definimos la estructura de navegación principal.
 */
export default function RootLayout() {
  // Aquí es donde en el futuro pondremos la lógica para verificar si el usuario está logueado.
  // Por ahora, definimos la estructura de navegación.

  return (
    // 1. Proveedor de Tema de Shopify Restyle
    <ThemeProvider theme={theme}>
      {/* 2. Proveedor de Tema de React Native Paper */}
      <PaperProvider theme={paperTheme}>
        {/* 3. Proveedor para React Query (TanStack Query) */}
        <QueryClientProvider client={queryClient}>
          {/* Stack principal que define los dos flujos de la app */}
          <Stack>
            {/* El flujo principal de la app (tabs) no muestra su propio header */}
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            {/* El flujo de autenticación tampoco muestra su propio header de nivel superior */}
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          </Stack>
        </QueryClientProvider>
      </PaperProvider>
    </ThemeProvider>
  );
}
