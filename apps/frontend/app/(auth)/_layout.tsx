// Este será el "contenedor" o layout para todas las pantallas de autenticación.

import { Stack } from 'expo-router';

/**
 * Este es el layout para el grupo de rutas de autenticación.
 * Define que todas las pantallas dentro de la carpeta (auth)
 * se comportarán como una pila de navegación (Stack).
 * Esto nos da automáticamente una barra de título y un botón de "atrás".
 */
export default function AuthLayout() {
  return (
    <Stack>
      {/* Podemos definir opciones por defecto para todas las pantallas del stack aquí.
          Por ejemplo, si quisiéramos que todas tuvieran un fondo oscuro y texto blanco
          en el header. */}
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="forgotPassword" options={{ headerShown: false }} />
      <Stack.Screen name="resetPassword" options={{ headerShown: false }} />
      <Stack.Screen name="verify-code" options={{ headerShown: false }} />
    </Stack>
  );
}
