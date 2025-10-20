import { createTheme } from '@shopify/restyle';
import { MD3LightTheme as DefaultPaperTheme } from 'react-native-paper';

// Paleta de colores. Podemos tener variantes para claro y oscuro.
const palette = {
  bluePrimary: '#2196F3',
  blueLight: '#BBDEFB',
  white: '#FFFFFF',
  black: '#000000',
  gray: '#9E9E9E',
  lightGray: '#F5F5F5',
};

// Definición del tema para @shopify/restyle
export const theme = createTheme({
  colors: {
    primary: palette.bluePrimary,
    background: palette.lightGray,
    cardBackground: palette.white,
    text: palette.black,
    textSecondary: palette.gray,
  },
  spacing: {
    s: 8,
    m: 16,
    l: 24,
    xl: 40,
  },
  breakpoints: {
    phone: 0,
    tablet: 768,
  },
  textVariants: {
    defaults: {
      color: 'text',
    },
    largeHeader: {
      fontSize: 24,
      fontWeight: 'bold',
    },
  },
});

// Definición del tema para React Native Paper
// Hereda los colores de nuestro tema principal para mantener la consistencia.
export const paperTheme = {
  ...DefaultPaperTheme,
  colors: {
    ...DefaultPaperTheme.colors,
    primary: theme.colors.primary,
    background: theme.colors.background,
  },
};

export type Theme = typeof theme;
