import { MotiView } from 'moti';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
};

export const Skeleton = ({
  width,
  height,
  borderRadius,
  style,
}: SkeletonProps) => {
  const theme = useTheme<Theme>();

  return (
    <MotiView
      // 1. Configuración de la Animación (El efecto "Pulse")
      from={{
        opacity: 0.3, // Empieza muy transparente (casi invisible)
      }}
      animate={{
        opacity: 0.7, // Sube hasta un 70% de visibilidad (no llega a sólido total)
      }}
      transition={{
        type: 'timing',
        duration: 900, // Un poco más rápido para que se sienta "vivo"
        loop: true, // Repetir infinitamente
        // Moti hace un "yoyo" (ida y vuelta) por defecto con loop: true
      }}
      // 2. Estilos Base
      style={[
        {
          width: width,
          height: height,
          // Usamos un color base. En modo oscuro, un gris claro con opacidad funciona mejor.
          // Si cardBackground es #1E1E1E, al bajarle la opacidad se verá sutil.
          backgroundColor: 'rgba(255, 255, 255, 0.50)',
          borderRadius: borderRadius || theme.spacing.s,
        },
        style,
      ]}
    />
  );
};
