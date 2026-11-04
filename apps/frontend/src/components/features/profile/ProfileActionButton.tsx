import { TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import MaterialCommunityIcons, {
  type MaterialDesignIconsIconName,
} from '@react-native-vector-icons/material-design-icons';
import { Box, Text } from '../../../shared/ui/base';
import { Theme } from '../../../shared/theme';

type ProfileActionButtonProps = {
  label: string;
  icon: MaterialDesignIconsIconName;
  onPress: () => void;
};

export const ProfileActionButton = ({
  label,
  icon,
  onPress,
}: ProfileActionButtonProps) => {
  const theme = useTheme<Theme>();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Box
        width={100} // Ancho fijo para uniformidad
        height={80}
        justifyContent="center"
        alignItems="center"
        borderRadius="m"
        marginRight="s"
        // Fondo sutil para cada botón (opcional, o transparente)
        backgroundColor="transparent"
        borderWidth={1}
        borderColor="cardBackground"
      >
        <Box marginBottom="s">
          <MaterialCommunityIcons
            name={icon}
            size={28}
            color={theme.colors.primary}
          />
        </Box>
        <Text
          variant="caption-md"
          fontWeight="bold"
          color="textPrimary"
          textAlign="center"
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {label}
        </Text>
      </Box>
    </TouchableOpacity>
  );
};
