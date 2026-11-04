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
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  withDelay,
  withRepeat,
  withTiming,
  useSharedValue,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../../../shared/ui/base';
import { Theme } from '../../../../shared/theme';
import { getSharedStyles } from '../../../../shared/theme/shared-styles';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * Número de paso con pulso de opacidad 0.5 -> 2 (el render la limita a 1) en
 * ida y vuelta. El delay (index + 400) aplica solo al arranque.
 */
const StepNumber = ({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) => {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withDelay(
      index + 400,
      withRepeat(withTiming(2, { duration: 2500 }), -1, true),
    );
    return () => cancelAnimation(opacity);
  }, [index, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
};

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
        {/* El delay por índice hace que los números se "activen" uno tras otro */}
        <StepNumber index={index}>
          <Mono color="primary" size={17}>
            {number}
          </Mono>
        </StepNumber>
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
