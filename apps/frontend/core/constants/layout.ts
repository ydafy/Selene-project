import { Dimensions, Platform } from 'react-native';

const { width, height } = Dimensions.get('window');

const BASE_WIDTH = 375;

export const scale = (size: number) => (width / BASE_WIDTH) * size;

export const SCREEN_WIDTH = width;
export const SCREEN_HEIGHT = height;

// Definimos el espaciado del grid aquí para usarlo en toda la app
const GRID_SPACING = 16;
const HORIZONTAL_PADDING = 16; // theme.spacing.m

export const LAYOUT = {
  screenPadding: HORIZONTAL_PADDING,

  // Cálculo exacto del ancho de columna para Masonry (2 columnas)
  // (AnchoPantalla - PaddingIzquierdo - PaddingDerecho - EspacioEntreColumnas) / 2
  masonryColumnWidth: (width - HORIZONTAL_PADDING * 2 - GRID_SPACING) / 2,

  // ... otros valores existentes
  productCardHeight: 260,
  productImageHeight: 160,
  productDetailImageHeight: 300,
  buttonHeight: 48,
  headerHeight: Platform.OS === 'ios' ? 44 : 56,
};

/**
 * Calcula la altura de una tarjeta basada en el aspect ratio de la imagen.
 * Incluye límites de seguridad.
 * @param aspectRatio - Relación ancho/alto de la imagen.
 */
export const getMasonryItemHeight = (aspectRatio: number = 1) => {
  const safeRatio = aspectRatio <= 0 ? 1 : aspectRatio;
  const height = LAYOUT.masonryColumnWidth / safeRatio;

  const MAX_HEIGHT = 320;
  const MIN_HEIGHT = 160;

  return Math.max(MIN_HEIGHT, Math.min(height, MAX_HEIGHT));
};
