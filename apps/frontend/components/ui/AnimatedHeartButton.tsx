import { MotiView } from 'moti';
import { IconButton } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';
import { Box } from '../base';

type AnimatedHeartButtonProps = {
  isFavorite: boolean;
  onPress: () => void;
  size?: number;
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
      <MotiView
        key={`icon-${isFavorite}`} // Forzamos el reinicio de la animación al cambiar
        from={{
          scale: isFavorite ? 0.3 : 1.3, // Si damos like, empieza chico. Si quitamos, empieza normal.
        }}
        animate={{
          scale: 1,
        }}
        transition={{
          // Usamos un resorte muy rápido y "seco" (sin rebote excesivo)
          type: 'timing',
          duration: 400,
        }}
      >
        <IconButton
          icon={isFavorite ? 'heart' : 'heart-outline'}
          iconColor={isFavorite ? activeColor : theme.colors.textPrimary}
          size={size}
          onPress={onPress}
          style={{ margin: 0 }}
        />
      </MotiView>
    </Box>
  );
};
