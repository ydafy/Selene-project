import { Chip as PaperChip } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';
import { StyleSheet, ViewStyle, StyleProp } from 'react-native'; // Importar tipos de estilo

type AppChipProps = {
  label: string;
  icon?: string;
  onPress?: () => void;
  onClose?: () => void;

  selected?: boolean;
  disabled?: boolean;
  showSelectedCheck?: boolean;

  backgroundColor?: keyof Theme['colors'];
  textColor?: keyof Theme['colors'];

  variant?: 'outlined' | 'flat';

  // 1. AÑADIMOS LA PROP STYLE
  style?: StyleProp<ViewStyle>;
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
  showSelectedCheck = false,
  style, // 2. DESESTRUCTURAMOS STYLE
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
      onClose={onClose}
      icon={icon}
      showSelectedCheck={showSelectedCheck}
      style={[
        styles.chip,
        {
          backgroundColor: variant === 'flat' ? bgColorHex : 'transparent',
          borderColor: variant === 'outlined' ? textColorHex : 'transparent',
          borderRadius: theme.borderRadii.s,
        },
        // 3. APLICAMOS EL STYLE EXTERNO AL FINAL
        // Esto permite que ResultsFilterBar sobrescriba padding, height, etc.
        style,
      ]}
      textStyle={{
        color: textColorHex,
        fontFamily: 'Montserrat-Bold',
        fontSize: 12,
        lineHeight: 18,
        textAlign: 'center',
        marginVertical: 0,
        marginRight: onClose ? 0 : 4,
        marginLeft: icon ? 0 : 4,
      }}
      elevated={false}
    >
      {label}
    </PaperChip>
  );
};

const styles = StyleSheet.create({
  chip: {
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
