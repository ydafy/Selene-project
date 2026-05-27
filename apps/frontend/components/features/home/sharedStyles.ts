/**
 * @file components/features/home/sharedStyles.ts
 * @description Estilos técnicos compartidos para mantener la consistencia
 * visual en todas las secciones del Monolito.
 */

import { StyleSheet } from 'react-native';
import { Theme } from '../../../core/theme';

export const getSharedStyles = (theme: Theme) =>
  StyleSheet.create({
    /**
     * Tipografía técnica tipo terminal.
     */
    monoText: {
      fontFamily: 'System',
      fontSize: 9,
      letterSpacing: 1.5,
      fontWeight: '600',
      textTransform: 'uppercase',
    },
    /**
     * Contenedor base para efectos de escaneo y HUD.
     */
    hudContainer: {
      backgroundColor: 'rgba(0, 0, 0, 0.2)',
      borderRadius: 8,
      borderWidth: 0.5,
      borderColor: theme.colors.separator,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
    },
    /**
     * Línea divisoria interna del Shell.
     */
    divider: {
      height: 1,
      backgroundColor: theme.colors.separator,
    },
  });
