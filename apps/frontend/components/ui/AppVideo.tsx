/**
 * @file components/ui/AppVideo.tsx
 * @description Versión corregida: Usa arquitectura de capas para el poster.
 * Evita errores de tipos y garantiza que la imagen de carga sea visible.
 */

import React, { useEffect } from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Box } from '../base';
import { AppImage } from './AppImage';

interface AppVideoProps {
  source: any;
  style?: ViewStyle;
  shouldPlay?: boolean;
  posterSource?: any;
}

export const AppVideo = ({
  source,
  style,
  shouldPlay = true,
  posterSource,
}: AppVideoProps) => {
  // 1. Inicializamos el player
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    if (shouldPlay) p.play();
  });

  // 2. Control de reproducción
  useEffect(() => {
    if (shouldPlay) {
      player.play();
    } else {
      player.pause();
    }
  }, [shouldPlay, player]);

  return (
    <Box style={[StyleSheet.absoluteFill, style]}>
      {/* CAPA 1: El Poster (Imagen de fondo) */}
      {posterSource && (
        <AppImage
          source={posterSource}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          priority="high"
        />
      )}

      {/* CAPA 2: El Video (Encima de la imagen) */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
    </Box>
  );
};
