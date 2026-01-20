import { TouchableOpacity, Dimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';

const { width } = Dimensions.get('window');
// Calculamos el ancho para 2 columnas con espaciado
const CARD_WIDTH = (width - 48) / 2;

type CategoryCardProps = {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: keyof Theme['colors'];
  onPress: () => void;
};

export const CategoryCard = ({
  label,
  icon,
  color,
  onPress,
}: CategoryCardProps) => {
  const theme = useTheme<Theme>();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Box
        width={CARD_WIDTH}
        height={120}
        backgroundColor="cardBackground"
        borderRadius="l"
        justifyContent="center"
        alignItems="center"
        marginBottom="m"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 3,
          elevation: 3,
          borderWidth: 1,
          borderColor: theme.colors.background,
        }}
      >
        <Box
          width={50}
          height={50}
          borderRadius="full"
          backgroundColor="background"
          justifyContent="center"
          alignItems="center"
          marginBottom="s"
        >
          <MaterialCommunityIcons
            name={icon}
            size={28}
            color={theme.colors[color]}
          />
        </Box>
        <Text variant="subheader-md" fontWeight="bold">
          {label}
        </Text>
      </Box>
    </TouchableOpacity>
  );
};
