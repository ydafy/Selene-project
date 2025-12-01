import { useEffect, useState } from 'react';
import { useNetInfo } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useTheme } from '@shopify/restyle';
import { Text, Box } from '../base';
import { Theme } from '../../core/theme';

export const OfflineNotice = () => {
  const netInfo = useNetInfo();
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();

  // Un pequeño delay para evitar parpadeos si la red cambia muy rápido
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (netInfo.isConnected === false) {
      setShow(true);
    } else {
      // Damos un segundo antes de ocultarlo para que el usuario vea que volvió
      const timer = setTimeout(() => setShow(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [netInfo.isConnected]);

  // Si hay internet y el estado show es falso, no renderizamos nada (para performance)
  if (netInfo.isConnected && !show) return null;

  return (
    <MotiView
      from={{ translateY: -100 }}
      animate={{ translateY: netInfo.isConnected ? -100 : 0 }}
      transition={{ type: 'timing', duration: 500 }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999, // Encima de todo, incluso modales
        backgroundColor: netInfo.isConnected
          ? theme.colors.success
          : theme.colors.error,
        paddingTop: insets.top, // Respetar el notch
        paddingBottom: theme.spacing.s,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box flexDirection="row" alignItems="center">
        <Text variant="body-sm" style={{ color: 'white', fontWeight: 'bold' }}>
          {netInfo.isConnected
            ? 'Conexión restablecida'
            : 'Sin conexión a internet'}
        </Text>
      </Box>
    </MotiView>
  );
};
