/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @file components/features/home/sections/ShellInspection.tsx
 * @description Versión 10.0: Infinite Circuit.
 * Un único "gusanito" láser recorre el fondo de las 4 celdas de forma continua.
 */

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  withRepeat,
  withTiming,
  useSharedValue,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../../base';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';
import { MotiView } from 'moti';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export const ShellInspection = () => {
  const theme = useTheme<Theme>();
  const sharedStyles = getSharedStyles(theme);

  // Valor para el recorrido del gusanito (ajustado a la longitud del path)
  const laserOffset = useSharedValue(1000);

  useEffect(() => {
    laserOffset.value = withRepeat(
      withTiming(0, {
        duration: 30000, // Velocidad equilibrada para el gusanito
        easing: Easing.linear,
      }),
      -1,
      false,
    );
  }, []);

  const Mono = ({ children, color = 'textSecondary', size = 8 }: any) => (
    <Text
      style={[
        sharedStyles.monoText,
        {
          color: theme.colors[color as keyof Theme['colors']] || color,
          fontSize: size,
        },
      ]}
    >
      {children}
    </Text>
  );

  /**
   * EL GUSANITO INFINITO
   * Se renderiza detrás del texto.
   */
  const InfiniteWorm = () => {
    // Un camino que recorre los centros de las celdas en bucle: 01 -> 02 -> 04 -> 03 -> 01
    const d = 'M5,5 H175 V175 H25 Z';

    const animatedProps = useAnimatedProps(() => ({
      strokeDashoffset: laserOffset.value,
    }));

    return (
      <Box style={StyleSheet.absoluteFill} pointerEvents="none" opacity={0.15}>
        <Svg height="100%" width="100%" viewBox="0 0 200 100">
          {/* Guía del circuito (opcional, muy tenue) */}
          <Path
            d={d}
            stroke={theme.colors.separator}
            strokeWidth="0.2"
            fill="none"
            opacity={1}
          />

          {/* El Gusanito (Láser único) */}
          <AnimatedPath
            d={d}
            stroke={theme.colors.primary}
            strokeWidth="1"
            fill="none"
            strokeDasharray="60, 100" // 20 de largo (el gusanito), 380 de espacio
            animatedProps={animatedProps}
          />
        </Svg>
      </Box>
    );
  };

  // --- SUB-COMPONENTE DE CELDA CON ANCLAJE FIJO ---
  const StepCell = ({
    number,
    title,
    subtext,
    index,
    hasRight,
    hasBottom,
  }: any) => (
    <Box
      flex={1}
      padding="l"
      minHeight={190}
      borderRightWidth={hasRight ? 1 : 0}
      borderBottomWidth={hasBottom ? 1 : 0}
      borderColor="separator"
      backgroundColor="transparent"
    >
      {/* SLOT 1: El Número Animado (Onda Secuencial) */}
      <Box height={30} justifyContent="center" marginBottom="s">
        <MotiView
          from={{ opacity: 0.5, scale: 1 }}
          animate={{
            opacity: 2, // El índice afecta la opacidad para crear un efecto de onda
            scale: 1,
          }}
          transition={{
            type: 'timing',
            duration: 2500,
            loop: true,
            repeatReverse: true,
            // El delay crea el efecto de que los números se "activan" uno tras otro
            delay: index + 400,
          }}
        >
          <Mono color="primary" size={17}>
            {number}
          </Mono>
        </MotiView>
      </Box>

      {/* SLOT 2: El Título (Altura fija de 45px) */}
      {/* Al fijar la altura aquí, el inicio del texto siempre será el mismo */}
      <Box height={45} justifyContent="flex-start">
        <Text
          variant="body-md"
          color="textPrimary"
          style={{ letterSpacing: 0.5, lineHeight: 18 }}
        >
          {title.toUpperCase()}
        </Text>
      </Box>

      {/* SLOT 3: El Subtexto (Altura fija de 60px) */}
      <Box height={60} marginTop="xs">
        <Text
          variant="caption-md"
          color="textSecondary"
          style={{ lineHeight: 16, opacity: 0.8 }}
        >
          {subtext}
        </Text>
      </Box>
    </Box>
  );

  return (
    <Box borderBottomWidth={1} borderBottomColor="separator">
      {/* 1. HEADER */}
      <Box padding="l" alignItems={'center'}>
        <Text variant="header-xl" color="textPrimary">
          Ciclo de Confianza
        </Text>
      </Box>

      {/* 2. GRID 2x2 CON GUSANITO DE FONDO */}
      <Box>
        {/* El láser se renderiza PRIMERO para que quede detrás */}
        <InfiniteWorm />

        <Box flexDirection="row">
          <StepCell
            number="01"
            index={0}
            title="Publicar"
            subtext="El producto se publica en Selene."
            hasRight
            hasBottom
          />
          <StepCell
            number="02"
            index={1}
            title="Verificar"
            subtext="El producto se manda a verificar a nuestra base de datos."
            hasBottom
          />
        </Box>
        <Box flexDirection="row">
          <StepCell
            number="03"
            index={2}
            title="Aprobar"
            subtext="Un NetRunner revisa y aprueba el producto para su venta."
            hasRight
          />
          <StepCell
            number="04"
            index={3}
            title="Vender"
            subtext="El producto ya verificado se puede vender en la plataforma."
          />
        </Box>
      </Box>

      {/* 3. RESUMEN FINAL */}
      {/* <Box padding="l">
        <Box flexDirection="row" gap="m" alignItems="center">
          <Box width={2} height={40} backgroundColor="primary" opacity={0.6} />
          <Text
            variant="body-sm"
            color="textSecondary"
            style={{ flex: 1, lineHeight: 18, fontStyle: 'italic' }}
          >
            Cada producto es verificado por Selene por nuestros{' '}
            <Text color="primary" fontWeight="bold">
              NetRunners
            </Text>
            antes de que se puedan comprar, esto para mantener un estándar de
            calidad para la comunidad.
          </Text>
        </Box>
      </Box> */}
    </Box>
  );
};
