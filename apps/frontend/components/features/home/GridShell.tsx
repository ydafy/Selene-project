/**
 * @file components/features/home/GridShell.tsx
 * @description Contenedor maestro con rejilla técnica optimizada.
 * Utiliza memoización para alto rendimiento y constantes para mantenibilidad.
 */

import React, { useMemo, memo } from 'react';
import { StyleSheet } from 'react-native';
import { Box } from '../../base';

// --- CONFIGURACIÓN TÉCNICA ---
const CELL_SIZE = 25; // Tamaño base del cuadro
const ACCENT_STEP = 3; // Cada cuántas líneas hay un acento (4 * 30 = 120px)
const LINE_OPACITY_BASE = 0.02; // Opacidad de líneas normales
const LINE_OPACITY_ACCENT = 0.05; // Opacidad de líneas maestras
const MAX_LINES_H = 60; // Suficiente para cubrir pantallas largas
const MAX_LINES_V = 25; // Suficiente para cubrir el ancho

interface GridShellProps {
  children: React.ReactNode;
}

const GridShellComponent = ({ children }: GridShellProps) => {
  // 1. GENERACIÓN MEMOIZADA DE LA REJILLA (Performance Pro)
  const gridLines = useMemo(() => {
    const horizontal = [...Array(MAX_LINES_H)].map((_, i) => (
      <Box
        key={`h-${i}`}
        position="absolute"
        top={i * CELL_SIZE}
        left={0}
        right={0}
        height={1}
        backgroundColor="foreground"
        opacity={
          i % ACCENT_STEP === 0 ? LINE_OPACITY_ACCENT : LINE_OPACITY_BASE
        }
      />
    ));

    const vertical = [...Array(MAX_LINES_V)].map((_, i) => (
      <Box
        key={`v-${i}`}
        position="absolute"
        left={i * CELL_SIZE}
        top={0}
        bottom={0}
        width={1}
        backgroundColor="foreground"
        opacity={
          i % ACCENT_STEP === 0 ? LINE_OPACITY_ACCENT : LINE_OPACITY_BASE
        }
      />
    ));

    return { horizontal, vertical };
  }, []);

  return (
    <Box
      backgroundColor="background"
      borderRadius="xl"
      overflow="hidden"
      borderWidth={0.8}
      borderColor="separator"
      style={styles.shellShadow}
    >
      {/* --- CAPA DE FONDO: REJILLA --- */}
      <Box style={StyleSheet.absoluteFill} pointerEvents="none">
        {gridLines.horizontal}
        {gridLines.vertical}
      </Box>

      {/* --- CONTENIDO --- */}
      <Box position="relative">{children}</Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  shellShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
});

// Export memoizado para evitar re-renders innecesarios
export const GridShell = memo(GridShellComponent, (prev, next) => {
  return prev.children === next.children;
});
