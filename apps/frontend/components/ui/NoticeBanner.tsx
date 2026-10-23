import { TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../base';
import { Theme } from '../../core/theme';

export type NoticeTone = 'info' | 'warning' | 'critical';

const TONE_COLOR: Record<NoticeTone, keyof Theme['colors']> = {
  info: 'textSecondary',
  warning: 'primary',
  critical: 'error',
};

type NoticeBannerProps = {
  tone: NoticeTone;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  message?: string;
  /** Makes the whole card pressable and shows a trailing chevron. */
  onPress?: () => void;
  accessibilityHint?: string;
};

/**
 * Card for important notices that ask the user to act. It owns its top margin
 * so a conditionally rendered notice leaves no gap when it is hidden, and it
 * fades in because it usually appears after the rest of the screen loaded.
 */
export const NoticeBanner = ({
  tone,
  icon,
  title,
  message,
  onPress,
  accessibilityHint,
}: NoticeBannerProps) => {
  const theme = useTheme<Theme>();
  const accent = TONE_COLOR[tone];

  const card = (
    <Box
      flexDirection="row"
      alignItems="center"
      padding="m"
      borderRadius="l"
      borderLeftWidth={4}
      borderLeftColor={accent}
      backgroundColor="cardBackground"
      gap="m"
    >
      <MaterialCommunityIcons
        name={icon}
        size={28}
        color={theme.colors[accent]}
      />
      <Box flex={1}>
        <Text variant="subheader-md" color="textPrimary">
          {title}
        </Text>
        {message ? (
          <Text
            variant="body-sm"
            color="textPrimary"
            opacity={0.75}
            marginTop="xs"
          >
            {message}
          </Text>
        ) : null}
      </Box>
      {onPress ? (
        <MaterialCommunityIcons
          name="chevron-right"
          size={24}
          color={theme.colors[accent]}
        />
      ) : null}
    </Box>
  );

  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      style={{ marginHorizontal: theme.spacing.m, marginTop: theme.spacing.m }}
    >
      {onPress ? (
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint={accessibilityHint}
        >
          {card}
        </TouchableOpacity>
      ) : (
        <Box accessible accessibilityLabel={title}>
          {card}
        </Box>
      )}
    </Animated.View>
  );
};
