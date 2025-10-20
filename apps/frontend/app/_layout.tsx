import { ThemeProvider } from '@shopify/restyle';
import { Stack } from 'expo-router';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import 'react-native-reanimated';
import '../core/i18n';

// Importamos nuestros temas personalizados
import { paperTheme, theme } from '../core/theme';

// Opcional: Esto ayuda a prevenir que la splash screen se oculte antes de tiempo
// import { useFonts } from 'expo-font';
// import * as SplashScreen from 'expo-splash-screen';
// SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Opcional: Lógica para cargar fuentes
  // const [loaded] = useFonts({ ... });
  // React.useEffect(() => {
  //   if (loaded) {
  //     SplashScreen.hideAsync();
  //   }
  // }, [loaded]);
  // if (!loaded) {
  //   return null;
  // }

  return (
    // 1. Proveedor de Tema de Shopify Restyle
    <ThemeProvider theme={theme}>
      {/* 2. Proveedor de Tema de React Native Paper */}
      <PaperProvider theme={paperTheme}>
        {/* El resto de tu aplicación vive aquí dentro */}
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </PaperProvider>
    </ThemeProvider>
  );
}
