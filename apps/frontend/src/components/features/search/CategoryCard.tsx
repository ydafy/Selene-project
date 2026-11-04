import { TouchableOpacity, Dimensions } from 'react-native';
import MaterialCommunityIcons, {
  type MaterialDesignIconsIconName,
} from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../../shared/ui/base';
import { Theme } from '../../../shared/theme';
import { buildCategoryCardA11yProps } from './categoryA11y';

const { width } = Dimensions.get('window');
// We calculate the width for 2 columns with spacing.
const CARD_WIDTH = (width - 48) / 2;

type CategoryCardProps = {
  label: string;
  icon: MaterialDesignIconsIconName;
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
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      {...buildCategoryCardA11yProps(label)}
    >
      <Box
        width={CARD_WIDTH}
        height={120}
        backgroundColor="cardBackground"
        borderRadius="l"
        justifyContent="center"
        alignItems="center"
        marginBottom="m"
        style={{
          shadowColor: theme.colors.shadow,
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
