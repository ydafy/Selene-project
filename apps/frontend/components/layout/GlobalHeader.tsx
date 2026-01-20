import { useRouter } from 'expo-router';
import { IconButton } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box, Text } from '../base';
import { Theme } from '../../core/theme';
import { LinearGradient } from 'expo-linear-gradient';

type GlobalHeaderProps = {
  title?: string;
  showBack?: boolean;
  // Mantenemos el patrón "Slot" porque es excelente para la flexibilidad
  headerRight?: React.ReactNode;
  backgroundColor?: keyof Theme['colors'];
};

export const GlobalHeader = ({
  title,
  showBack = false,
  headerRight,
  backgroundColor = 'cardBackground',
}: GlobalHeaderProps) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const GRADIENT_HEIGHT = insets.top + 60;

  return (
    <>
      <LinearGradient
        colors={['#121212', 'transparent']} // De oscuro a transparente
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: GRADIENT_HEIGHT,
          zIndex: 99, // Debajo de la cápsula, encima del contenido
        }}
        pointerEvents="none" // Importante: deja pasar los clicks a través de él
      />
      <Box
        position="absolute"
        top={insets.top + 10}
        left={theme.spacing.m}
        right={theme.spacing.m}
        zIndex={100}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        backgroundColor={backgroundColor}
        paddingVertical="m" // Padding cómodo
        paddingHorizontal="s"
        borderRadius="l"
        // Sombra estática y elegante
        style={{
          elevation: 4,
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        {/* --- LADO IZQUIERDO (Atrás) --- */}
        <Box width={40} alignItems="center">
          {showBack ? (
            <IconButton
              icon="arrow-left"
              iconColor={theme.colors.textPrimary}
              size={24}
              onPress={() => router.back()}
              style={{ margin: 0 }}
            />
          ) : (
            <Box width={24} />
          )}
        </Box>

        {/* --- CENTRO (Título) --- */}
        <Box flex={1} alignItems="center">
          {title && (
            <Text variant="subheader-md" fontWeight="bold" numberOfLines={1}>
              {title}
            </Text>
          )}
        </Box>

        {/* --- LADO DERECHO (Slot Dinámico) --- */}
        <Box minWidth={40} alignItems="flex-end" justifyContent="center">
          {headerRight}
        </Box>
      </Box>
    </>
  );
};
