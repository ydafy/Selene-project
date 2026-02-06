import { useRouter } from 'expo-router';
import { IconButton } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box, Text } from '../base';
import { Theme } from '../../core/theme';
import { LinearGradient } from 'expo-linear-gradient';

type GlobalHeaderProps = {
  title?: string;
  titleComponent?: React.ReactNode;
  showBack?: boolean;
  headerRight?: React.ReactNode;
  backgroundColor?: keyof Theme['colors'];
  alignTitle?: 'center' | 'flex-start';
  useSafeArea?: boolean;
};

export const GlobalHeader = ({
  title,
  titleComponent,
  showBack = false,
  headerRight,
  backgroundColor = 'cardBackground',
  alignTitle = 'center',
  useSafeArea = true,
}: GlobalHeaderProps) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topInset = useSafeArea ? insets.top : 0;
  const GRADIENT_HEIGHT = insets.top + 60;

  return (
    <>
      <LinearGradient
        colors={['#121212', 'transparent']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: GRADIENT_HEIGHT,
          zIndex: 99,
        }}
        pointerEvents="none"
      />
      <Box
        position="absolute"
        top={topInset + 10}
        left={theme.spacing.m}
        right={theme.spacing.m}
        zIndex={100}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        backgroundColor={backgroundColor}
        paddingVertical="s" // Reduje un poco a 's' para dar espacio a componentes más altos si es necesario
        paddingHorizontal="s"
        borderRadius="l"
        style={{
          elevation: 4,
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
          minHeight: 50,
        }}
      >
        {/* --- LADO IZQUIERDO (Atrás) --- */}
        {(showBack || alignTitle === 'center') && (
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
        )}

        {/* --- CENTRO (Título o Componente Custom) --- */}
        <Box flex={1} alignItems={alignTitle} justifyContent="center">
          {titleComponent
            ? // Si hay componente custom (Botón de dirección), lo mostramos
              titleComponent
            : // Si no, mostramos el texto estándar
              title && (
                <Text
                  variant="subheader-md"
                  fontWeight="bold"
                  numberOfLines={1}
                >
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
