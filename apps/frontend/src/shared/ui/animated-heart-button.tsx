import { useEffect, type ReactNode } from 'react';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { IconButton } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../theme';
import { Box } from './base';

type AnimatedHeartButtonProps = {
  isFavorite: boolean;
  onPress: () => void;
  size?: number;
};

// Si damos like, el icono empieza chico. Si quitamos, empieza grande. Se
// monta de nuevo (key) en cada cambio para reiniciar la animación.
const HeartScale = ({
  isFavorite,
  children,
}: {
  isFavorite: boolean;
  children: ReactNode;
}) => {
  const scale = useSharedValue(isFavorite ? 0.3 : 1.3);

  useEffect(() => {
    scale.value = withTiming(1, { duration: 400 });
    return () => cancelAnimation(scale);
  }, [scale]);

  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={scaleStyle}>{children}</Animated.View>;
};

export const AnimatedHeartButton = ({
  isFavorite,
  onPress,
  size = 26,
}: AnimatedHeartButtonProps) => {
  const theme = useTheme<Theme>();

  // Colores
  const activeColor = theme.colors.error; // Rojo
  const inactiveColor = theme.colors.background; // Gris
  const borderColor = isFavorite ? activeColor : inactiveColor;

  return (
    // Mantenemos el borde y el fondo, pero fijos en tamaño.
    <Box
      width={size * 2.4}
      height={size * 2.4}
      borderRadius="xl"
      justifyContent="center"
      alignItems="center"
      backgroundColor="cardBackground"
      borderWidth={2}
      style={{ borderColor }} // El color cambia instantáneamente (más rápido = mejor percepción)
    >
      {/* 2. Solo animamos el ICONO (Escala) */}
      <HeartScale key={`icon-${isFavorite}`} isFavorite={isFavorite}>
        <IconButton
          icon={isFavorite ? 'heart' : 'heart-outline'}
          iconColor={isFavorite ? activeColor : theme.colors.textPrimary}
          size={size}
          onPress={onPress}
          style={{ margin: 0 }}
        />
      </HeartScale>
    </Box>
  );
};
