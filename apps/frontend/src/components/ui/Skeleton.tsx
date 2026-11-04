import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  marginBottom?: number | string;
  marginTop?: number | string;
  borderRadius?: number | string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
};

export const Skeleton = ({
  width,
  height,
  borderRadius,
  style,
  marginBottom,
  marginTop,
}: SkeletonProps) => {
  const theme = useTheme<Theme>();
  const opacity = useSharedValue(0.3); // Empieza muy transparente

  // Efecto "Pulse": sube hasta 0.7 (no llega a sólido total) y vuelve, sin fin
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.7, { duration: 900 }), // Un poco más rápido para que se sienta "vivo"
      -1,
      true, // Ida y vuelta (yoyo)
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width: width,
          height: height,
          marginBottom: marginBottom,
          marginTop: marginTop,
          // Usamos un color base. En modo oscuro, un gris claro con opacidad funciona mejor.
          // Si cardBackground es #1E1E1E, al bajarle la opacidad se verá sutil.
          backgroundColor: theme.colors.skeletonShimmer,
          borderRadius: borderRadius || theme.spacing.s,
        },
        pulseStyle,
        style,
      ]}
    />
  );
};
