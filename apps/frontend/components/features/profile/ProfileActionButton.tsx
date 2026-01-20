import { TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';

type ProfileActionButtonProps = {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
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
