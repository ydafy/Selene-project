import { Chip as PaperChip } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';
import { StyleSheet } from 'react-native';

type AppChipProps = {
  label: string;
  icon?: string; // Nombre del icono de MaterialCommunityIcons

  // Interacciones
  onPress?: () => void;
  onClose?: () => void; // Si se pasa, muestra la 'X'

  // Estado
  selected?: boolean;
  disabled?: boolean;
  showSelectedCheck?: boolean; // Controla si sale el ✔️ al seleccionar

  // Personalización de colores
  backgroundColor?: keyof Theme['colors'];
  textColor?: keyof Theme['colors'];

  // Estilo
  variant?: 'outlined' | 'flat';
};

export const AppChip = ({
  label,
  icon,
  onPress,
  onClose,
  backgroundColor = 'background',
  textColor = 'textPrimary',
  variant = 'flat',
  selected = false,
  disabled = false,
  showSelectedCheck = false, // Por defecto false para diseño minimalista (solo cambio de color)
}: AppChipProps) => {
  const theme = useTheme<Theme>();

  const bgColorHex = theme.colors[backgroundColor];
  const textColorHex = theme.colors[textColor];

  return (
    <PaperChip
      mode={variant}
      selected={selected}
      disabled={disabled}
      onPress={onPress}
      onClose={onClose} // Activa el modo "Input Chip" con botón de cerrar
      icon={icon}
      showSelectedCheck={showSelectedCheck} // Controlamos el icono de check
      // Estilos del Contenedor
      style={[
        styles.chip,
        {
          backgroundColor: variant === 'flat' ? bgColorHex : 'transparent',
          borderColor: variant === 'outlined' ? textColorHex : 'transparent',
          borderRadius: theme.borderRadii.s,
        },
      ]}
      // Estilos del Texto
      textStyle={{
        color: textColorHex,
        fontFamily: 'Montserrat-Bold',
        fontSize: 12,
        lineHeight: 18,
        // CORRECCIÓN DE ALINEACIÓN:
        textAlign: 'center',
        marginVertical: 0,
        marginRight: onClose ? 0 : 4, // Ajuste fino si hay botón de cerrar
        marginLeft: icon ? 0 : 4, // Ajuste fino si hay icono
      }}
      // Quitamos 'compact' para tener más control sobre el layout interno
      // compact
      elevated={false}
    >
      {label}
    </PaperChip>
  );
};

const styles = StyleSheet.create({
  chip: {
    height: 32, // Un poco más alto para mejor área de toque
    alignItems: 'center',
    justifyContent: 'center',
  },
});
