import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';

type SettingsRowProps = {
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  description?: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  rightSlot?: React.ReactNode;
  showChevron?: boolean;
};

/**
 * Single tappable row inside a settings section. Designed to match the
 * cardBackground + chevron pattern used across the Profile tab.
 */
export const SettingsRow = ({
  icon,
  label,
  description,
  onPress,
  disabled = false,
  destructive = false,
  rightSlot,
  showChevron = true,
}: SettingsRowProps) => {
  const theme = useTheme<Theme>();

  const labelColor = destructive ? 'error' : 'textPrimary';
  const iconColor = destructive
    ? theme.colors.error
    : theme.colors.textSecondary;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled || !onPress}
    >
      <Box
        flexDirection="row"
        alignItems="center"
        paddingVertical="m"
        paddingHorizontal="m"
        opacity={disabled ? 0.5 : 1}
      >
        {icon && (
          <Box marginRight="m">
            <MaterialCommunityIcons name={icon} size={22} color={iconColor} />
          </Box>
        )}

        <Box flex={1}>
          <Text variant="body-md" color={labelColor}>
            {label}
          </Text>
          {description && (
            <Text variant="caption-md" color="textSecondary" marginTop="xs">
              {description}
            </Text>
          )}
        </Box>

        {rightSlot ? (
          <Box marginLeft="s">{rightSlot}</Box>
        ) : (
          showChevron &&
          onPress && (
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={theme.colors.textSecondary}
            />
          )
        )}
      </Box>
    </TouchableOpacity>
  );
};
