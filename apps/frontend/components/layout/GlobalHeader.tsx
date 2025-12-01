import { useRouter } from 'expo-router';
import { IconButton } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box, Text } from '../base';
import { Theme } from '../../core/theme';

type GlobalHeaderProps = {
  title?: string;
  showBack?: boolean;
  // CAMBIO CLAVE: En lugar de strings de iconos, aceptamos un componente de React
  headerRight?: React.ReactNode;
  backgroundColor?: keyof Theme['colors'];
};

export const GlobalHeader = ({
  title,
  showBack = false,
  headerRight, // Recibimos el componente
  backgroundColor = 'cardBackground',
}: GlobalHeaderProps) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
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
      paddingVertical="s"
      paddingHorizontal="s"
      borderRadius="l"
      style={{
        elevation: 4,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      {/* --- SLOT IZQUIERDO (Atrás) --- */}
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

      {/* --- SLOT CENTRAL (Título) --- */}
      <Box flex={1} alignItems="center">
        {title && (
          <Text variant="subheader-md" numberOfLines={1}>
            {title}
          </Text>
        )}
      </Box>

      {/* --- SLOT DERECHO (Dinámico) --- */}
      {/* Aquí renderizamos lo que sea que nos manden */}
      <Box minWidth={40} alignItems="flex-end" justifyContent="center">
        {headerRight}
      </Box>
    </Box>
  );
};
