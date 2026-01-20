import { TouchableOpacity, TouchableOpacityProps } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { Text } from '../base';
import { Theme } from '../../core/theme';
import GoogleLogoIcon from '../icons/GoogleLogoIcon'; // <-- Importamos nuestro nuevo componente de icono

type GoogleButtonProps = Omit<TouchableOpacityProps, 'children'> & {
  onPress: () => void;
  label: string;
};

export const GoogleButton = ({
  onPress,
  label,
  ...rest
}: GoogleButtonProps) => {
  const theme = useTheme<Theme>();

  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.textPrimary,
        borderRadius: 30,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: theme.colors.cardBackground,
      }}
      {...rest}
    >
      <GoogleLogoIcon width={20} height={20} />
      <Text
        variant="body-lg"
        style={{
          color: theme.colors.background,
          fontWeight: 'bold',
          marginLeft: 12,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};
