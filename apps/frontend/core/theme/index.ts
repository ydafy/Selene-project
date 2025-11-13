import { createTheme } from '@shopify/restyle';
// Importamos el tema oscuro de Material Design 3 como base
import { MD3DarkTheme as DefaultPaperTheme } from 'react-native-paper';

// 1. Tu paleta de colores definida.
const palette = {
  lion: '#bd9f65',
  blueLight: '#6f839f',
  platinum: '#E4E4E4',
  night: '#121212',
  stateGray: '#717C89',
  forest: '#28a745',
  fire: '#dc3545',
};

// 2. Mapeamos la paleta a roles semánticos en el tema de Restyle.
export const theme = createTheme({
  colors: {
    // Roles Base
    background: palette.night,
    foreground: palette.platinum,
    primary: palette.lion,

    // Roles de Texto
    textPrimary: palette.platinum,
    textSecondary: palette.blueLight,

    // Roles de Superficie
    cardBackground: palette.stateGray,

    // Roles de Estado
    success: palette.forest,
    error: palette.fire,
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
      fontFamily: 'System',
      color: 'textPrimary',
    },
    header: {
      fontSize: 28,
      fontWeight: '700',
      color: 'textPrimary',
    },
    body: {
      fontSize: 16,
      color: 'textPrimary',
    },
    subdued: {
      fontSize: 14,
      color: 'textSecondary',
    },
  },
});

// 3. Configuramos el tema de React Native Paper para que sea 100% coherente.
export const paperTheme = {
  ...DefaultPaperTheme,
  dark: true,
  roundness: 12,
  colors: {
    ...DefaultPaperTheme.colors,
    primary: theme.colors.primary,
    background: theme.colors.background,
    surface: theme.colors.background, // Hacemos que el fondo de los inputs sea el mismo que el de la pantalla
    onSurface: theme.colors.textPrimary,
    placeholder: theme.colors.textSecondary,
    outline: theme.colors.textSecondary,
    error: theme.colors.error,
  },
};

export type Theme = typeof theme;
