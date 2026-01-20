/**
 * =================================================================================
 * SELENE DESIGN SYSTEM - GUÍA DE TIPOGRAFÍA
 * =================================================================================
 * Este archivo define la escala tipográfica semántica para la aplicación Selene.
 * Usa estas variantes para asegurar una consistencia visual en toda la UI.
 *
 * --- GUÍA DE USO RÁPIDO ---
 *
 * 1. TÍTULOS DE PANTALLA (header-):
 *    - 'header-2xl': El título más grande y prominente. Usar con moderación,
 *                    idealmente solo una vez por pantalla (ej. "Únete a Selene").
 *    - 'header-xl': Un título principal ligeramente más pequeño, para pantallas
 *                   importantes pero secundarias.
 *
 * 2. SUBTÍTULOS (subheader-):
 *    - 'subheader-lg': Para títulos de secciones dentro de una pantalla (ej. "Especificaciones").
 *    - 'subheader-md': Para subtítulos de menor jerarquía o títulos de tarjetas.
 *
 * 3. CUERPO DE TEXTO (body-):
 *    - 'body-lg': Para párrafos de lectura importantes o texto destacado.
 *    - 'body-md': El tamaño de texto estándar para la mayoría del contenido y labels de inputs.
 *    - 'body-sm': Para texto más pequeño, como detalles finos o notas.
 *
 * 4. TEXTO DE CAPTURA/SECUNDARIO (caption-):
 *    - 'caption-lg' / 'caption-md': Para texto con menor énfasis, como placeholders,
 *                                  metadatos (fechas, "Miembro desde..."), o mensajes
 *                                  de ayuda. Heredan el `textSecondary` color.
 *
 * 5. VARIANTE POR DEFECTO (defaults):
 *    - Si no se especifica una variante en un componente <Text>, usará esta.
 *      Equivale a 'body-lg'.
 *
 * =================================================================================
 */

import { createTheme } from '@shopify/restyle';
import { MD3DarkTheme as DefaultPaperTheme } from 'react-native-paper';
import {
  DarkTheme as NavigationDarkTheme,
  Theme as NavThemeType,
} from '@react-navigation/native';

// 1. Tu paleta de colores definida.
const palette = {
  lion: '#bd9f65',
  blueLight: '#6f839f',
  platinum: '#E4E4E4',
  night: '#121212',
  stateGray: '#1E1E1E',
  forest: '#28a745',
  fire: '#dc3545',
  blueGray: 'rgba(255, 255, 255, 0.1)',
  shadow: 'rgba(0,0,0,0.6)',
  transparent: '#00000000',
};

// 2. Mapeamos la paleta a roles semánticos en el tema de Restyle.
export const theme = createTheme({
  // ... (tu sección 'colors' se mantiene igual)
  colors: {
    background: palette.night,
    foreground: palette.platinum,
    primary: palette.lion,
    textPrimary: palette.platinum,
    textSecondary: palette.blueLight,
    cardBackground: palette.stateGray,
    focus: palette.shadow,
    success: palette.forest,
    error: palette.fire,
    separator: palette.blueGray,
    transparent: palette.transparent,
  },
  spacing: { xs: 4, s: 8, m: 16, l: 24, xl: 40 },
  borderRadii: {
    s: 8,
    m: 16,
    l: 24,
    xl: 40,
    full: 999, // Para círculos perfectos
  },
  breakpoints: { phone: 0, tablet: 768 },
  // Tu sección 'textVariants' para Restyle se mantiene igual
  textVariants: {
    'header-2xl': {
      fontFamily: 'Montserrat-Medium',
      fontSize: 36,
      lineHeight: 40,
      color: 'textPrimary',
    },
    'header-xl': {
      fontFamily: 'Montserrat-Medium',
      fontSize: 28,
      lineHeight: 36,
      color: 'textPrimary',
    },
    'subheader-lg': {
      fontFamily: 'Montserrat-Medium',
      fontSize: 22,
      lineHeight: 29,
      color: 'textPrimary',
    },
    'subheader-md': {
      fontFamily: 'Montserrat-Medium',
      fontSize: 16,
      lineHeight: 24,
      color: 'textPrimary',
    },
    'body-lg': {
      fontFamily: 'Montserrat-Regular',
      fontSize: 16,
      lineHeight: 28,
      color: 'textPrimary',
    },
    'body-md': {
      fontFamily: 'Montserrat-Regular',
      fontSize: 14,
      lineHeight: 24,
      color: 'textPrimary',
    },
    'body-sm': {
      fontFamily: 'Montserrat-Regular',
      fontSize: 12,
      lineHeight: 16,
      color: 'textPrimary',
    },
    'caption-lg': {
      fontFamily: 'Montserrat-Regular',
      fontSize: 14,
      lineHeight: 20,
      color: 'textSecondary',
    },
    'caption-md': {
      fontFamily: 'Montserrat-Regular',
      fontSize: 12,
      lineHeight: 16,
      color: 'textSecondary',
    },
    defaults: {
      fontFamily: 'Montserrat-Regular',
      fontSize: 16,
      lineHeight: 24,
      color: 'textPrimary',
    },
  },
});

// 3. Configuramos el tema de React Native Paper para que sea 100% coherente.
export const paperTheme = {
  ...DefaultPaperTheme,
  dark: true,
  roundness: 12,
  // --- ESTA ES LA SECCIÓN CORREGIDA Y COMPLETA ---
  fonts: {
    ...DefaultPaperTheme.fonts, // Empezamos con los defaults de Paper
    // Y ahora sobreescribimos cada familia de fuente
    default: {
      ...DefaultPaperTheme.fonts.default,
      fontFamily: 'Montserrat-Regular',
    },
    // Mapeamos las variantes de Material Design 3 a nuestras fuentes
    displayLarge: {
      ...DefaultPaperTheme.fonts.displayLarge,
      fontFamily: 'Montserrat-Bold',
    },
    displayMedium: {
      ...DefaultPaperTheme.fonts.displayMedium,
      fontFamily: 'Montserrat-Bold',
    },
    displaySmall: {
      ...DefaultPaperTheme.fonts.displaySmall,
      fontFamily: 'Montserrat-Bold',
    },
    headlineLarge: {
      ...DefaultPaperTheme.fonts.headlineLarge,
      fontFamily: 'Montserrat-Bold',
    },
    headlineMedium: {
      ...DefaultPaperTheme.fonts.headlineMedium,
      fontFamily: 'Montserrat-Bold',
    },
    headlineSmall: {
      ...DefaultPaperTheme.fonts.headlineSmall,
      fontFamily: 'Montserrat-Bold',
    },
    titleLarge: {
      ...DefaultPaperTheme.fonts.titleLarge,
      fontFamily: 'Montserrat-Medium',
    },
    titleMedium: {
      ...DefaultPaperTheme.fonts.titleMedium,
      fontFamily: 'Montserrat-Medium',
    },
    titleSmall: {
      ...DefaultPaperTheme.fonts.titleSmall,
      fontFamily: 'Montserrat-Medium',
    },
    bodyLarge: {
      ...DefaultPaperTheme.fonts.bodyLarge,
      fontFamily: 'Montserrat-Regular',
    },
    bodyMedium: {
      ...DefaultPaperTheme.fonts.bodyMedium,
      fontFamily: 'Montserrat-Regular',
    },
    bodySmall: {
      ...DefaultPaperTheme.fonts.bodySmall,
      fontFamily: 'Montserrat-Regular',
    },
    labelLarge: {
      ...DefaultPaperTheme.fonts.labelLarge,
      fontFamily: 'Montserrat-Medium',
    },
    labelMedium: {
      ...DefaultPaperTheme.fonts.labelMedium,
      fontFamily: 'Montserrat-Medium',
    },
    labelSmall: {
      ...DefaultPaperTheme.fonts.labelSmall,
      fontFamily: 'Montserrat-Regular',
    },
  },
  colors: {
    ...DefaultPaperTheme.colors,
    primary: theme.colors.primary,
    background: theme.colors.background,
    surface: theme.colors.background,
    onSurface: theme.colors.textPrimary,
    placeholder: theme.colors.textSecondary,
    outline: theme.colors.textSecondary,
    error: theme.colors.error,
  },
};
export const navigationTheme: NavThemeType = {
  ...NavigationDarkTheme,
  colors: {
    ...NavigationDarkTheme.colors,
    background: theme.colors.background, // Se sincroniza con 'night'
    card: theme.colors.cardBackground, // Se sincroniza con 'stateGray'
    text: theme.colors.textPrimary, // Se sincroniza con 'platinum'
    border: theme.colors.cardBackground, // Para bordes de headers
    primary: theme.colors.primary, // Para el tint color activo
    notification: theme.colors.error, // Para badges
  },
};

export type Theme = typeof theme;
