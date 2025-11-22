import { TouchableOpacity } from 'react-native';
import { Checkbox as PaperCheckbox } from 'react-native-paper';
import { Box } from '../base';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';

type CheckboxProps = {
  status: 'checked' | 'unchecked' | 'indeterminate';
  onPress: () => void;
  label: React.ReactNode; // Ahora sí podemos usar un ReactNode
};

/**
 * Checkbox es nuestro componente de casilla de verificación personalizado.
 * Construido con primitivas para permitir un label complejo (con enlaces).
 */
export const Checkbox = ({ status, onPress, label }: CheckboxProps) => {
  const theme = useTheme<Theme>();

  return (
    // Hacemos que toda la fila sea clickeable para una mejor UX
    <TouchableOpacity
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center' }}
    >
      {/* Contenedor para el checkbox en sí */}
      <Box marginRight="s">
        <PaperCheckbox.Android
          status={status}
          onPress={onPress}
          color={theme.colors.primary}
          uncheckedColor={theme.colors.textSecondary}
        />
      </Box>

      {/* Contenedor para el label, que puede ser texto complejo */}
      <Box flex={1}>{label}</Box>
    </TouchableOpacity>
  );
};
