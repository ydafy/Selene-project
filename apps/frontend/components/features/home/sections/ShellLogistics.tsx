/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * @file components/features/home/sections/ShellLogistics.tsx
 * @description Sección de logística nacional auditada.
 * Optimización de animaciones SVG y limpieza de i18n.
 */

import React, { useEffect, memo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, {
  Path,
  Circle,
  Defs,
  LinearGradient,
  Stop,
} from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  withRepeat,
  withTiming,
  useSharedValue,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons'; // FIX: Import limpio

import { Box, Text } from '../../../base';
import { AppImage } from '../../../ui/AppImage';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// --- CONSTANTES DE ANIMACIÓN ---
const DURATION = 6000;
const ROUTES_CONFIG = [
  { key: 'hmo_mex', path: 'M 94 140 Q 150 100 220 280', delay: 0 },
  { key: 'gdl_mty', path: 'M 170 255 Q 200 210 190 160', delay: 1000 },
  { key: 'mex_cun', path: 'M 220 280 Q 300 240 360 250', delay: 2500 },
  { key: 'mty_mex', path: 'M 190 160 Q 210 220 220 280', delay: 4000 },
  { key: 'hmo_gdl', path: 'M 94 140 Q 110 200 170 255', delay: 5500 },
];

const ShellLogisticsComponent = () => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('home');
  const sharedStyles = getSharedStyles(theme);

  // Inicializamos los 5 progresos en un array de SharedValues
  const progresses = [
    useSharedValue(1000),
    useSharedValue(1000),
    useSharedValue(1000),
    useSharedValue(1000),
    useSharedValue(1000),
  ];

  useEffect(() => {
    const config = {
      duration: DURATION,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    };

    progresses.forEach((p, i) => {
      p.value = withDelay(
        ROUTES_CONFIG[i].delay,
        withRepeat(withTiming(0, config), -1, false),
      );
    });

    // Cleanup: Detener animaciones al desmontar para ahorrar batería
    return () => progresses.forEach((p) => (p.value = 1000));
  }, []);

  // Generamos los props animados dinámicamente
  const animatedProps = progresses.map((p) =>
    useAnimatedProps(() => ({ strokeDashoffset: p.value })),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Mono = ({ children, color = 'textSecondary', size = 7 }: any) => (
    <Text
      variant="caption-md"
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

  return (
    <Box borderBottomWidth={1} borderBottomColor="separator">
      <Box padding="l">
        <Mono color="primary" size={8}>
          {t('logistics.header')}
        </Mono>
        <Text variant="header-xl" color="textPrimary" marginTop="s">
          {t('logistics.title')}
        </Text>
      </Box>

      <Box
        height={300}
        width="100%"
        justifyContent="center"
        alignItems="center"
      >
        <AppImage
          source={require('../../../../assets/images/home/mexicoMap.webp')}
          style={{ width: '90%', height: '90%', opacity: 0.2 }}
          contentFit="contain"
          memoryKey="mexico-map-bg"
        />

        <Box style={StyleSheet.absoluteFill}>
          <Svg height="100%" width="100%" viewBox="0 0 400 400">
            <Defs>
              <LinearGradient id="laserGrad" x1="0" y1="0" x2="1" y2="1">
                <Stop
                  offset="0"
                  stopColor={theme.colors.primary}
                  stopOpacity="0"
                />
                <Stop
                  offset="1"
                  stopColor={theme.colors.primary}
                  stopOpacity="1"
                />
              </LinearGradient>
            </Defs>

            {ROUTES_CONFIG.map((route, index) => (
              <React.Fragment key={route.key}>
                <Path
                  d={route.path}
                  stroke={theme.colors.textPrimary}
                  strokeWidth="0.5"
                  fill="none"
                  opacity={0.1}
                />
                <AnimatedPath
                  d={route.path}
                  stroke="url(#laserGrad)"
                  strokeWidth="2"
                  fill="none"
                  strokeDasharray="60, 940"
                  animatedProps={animatedProps[index]}
                />
              </React.Fragment>
            ))}

            {[
              { x: 94, y: 140 },
              { x: 190, y: 160 },
              { x: 170, y: 255 },
              { x: 220, y: 280 },
              { x: 360, y: 250 },
            ].map((node, i) => (
              <Circle
                key={i}
                cx={node.x}
                cy={node.y}
                r="2"
                fill={theme.colors.primary}
              />
            ))}
          </Svg>
        </Box>
      </Box>

      <Box padding="l">
        <Box
          flexDirection="row"
          flexWrap="wrap"
          justifyContent="space-between"
          style={{ rowGap: 24 }}
        >
          <Box width="48%" flexDirection="row" alignItems="center" gap="s">
            <MaterialCommunityIcons
              name="map-marker-distance"
              size={18}
              color={theme.colors.primary}
            />
            <Box>
              <Mono color="textPrimary" size={8}>
                {t('logistics.items.coverage.label')}
              </Mono>
              <Text
                variant="caption-md"
                color="textSecondary"
                style={{ fontSize: 10 }}
              >
                {t('logistics.items.coverage.value')}
              </Text>
            </Box>
          </Box>
          <Box width="48%" flexDirection="row" alignItems="center" gap="s">
            <MaterialCommunityIcons
              name="shield-airplane-outline"
              size={18}
              color={theme.colors.primary}
            />
            <Box>
              <Mono color="textPrimary" size={8}>
                {t('logistics.items.protection.label')}
              </Mono>
              <Text
                variant="caption-md"
                color="textSecondary"
                style={{ fontSize: 10 }}
              >
                {t('logistics.items.protection.value')}
              </Text>
            </Box>
          </Box>
          <Box width="48%" flexDirection="row" alignItems="center" gap="s">
            <MaterialCommunityIcons
              name="radar"
              size={18}
              color={theme.colors.primary}
            />
            <Box>
              <Mono color="textPrimary" size={8}>
                {t('logistics.items.tracking.label')}
              </Mono>
              <Text
                variant="caption-md"
                color="textSecondary"
                style={{ fontSize: 10 }}
              >
                {t('logistics.items.tracking.value')}
              </Text>
            </Box>
          </Box>
          <Box width="48%" flexDirection="row" alignItems="center" gap="s">
            <MaterialCommunityIcons
              name="timer-outline"
              size={18}
              color={theme.colors.primary}
            />
            <Box>
              <Mono color="textPrimary" size={8}>
                {t('logistics.items.delivery.label')}
              </Mono>
              <Text
                variant="caption-md"
                color="textSecondary"
                style={{ fontSize: 10 }}
              >
                {t('logistics.items.delivery.value')}
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export const ShellLogistics = memo(ShellLogisticsComponent);
