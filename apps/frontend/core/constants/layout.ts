import { Dimensions, Platform } from 'react-native';

const { width, height } = Dimensions.get('window');

// Un ancho base de diseño (ej. el ancho del iPhone 11/12/13/14/15 estándar)
const BASE_WIDTH = 375;

/**
 * Función simple para escalar elementos horizontalmente si es necesario.
 * Úsala con moderación. Prefiere Flexbox.
 */
export const scale = (size: number) => (width / BASE_WIDTH) * size;

export const SCREEN_WIDTH = width;
export const SCREEN_HEIGHT = height;

export const LAYOUT = {
  // Márgenes estándar
  screenPadding: 24, // Coincide con nuestro theme.spacing.l o xl

  // Productos
  productCardHeight: 260,
  productImageHeight: 160,
  productDetailImageHeight: 300,

  // Cálculos de Grid
  // (Ancho de pantalla - padding total) / 2 columnas
  productCardWidth: (width - 24 * 2 - 16) / 2,

  // UI Elements
  buttonHeight: 48,
  headerHeight: Platform.OS === 'ios' ? 44 : 56,
};
