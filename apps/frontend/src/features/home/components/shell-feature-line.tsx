/**
 * @file features/home/components/shell-feature-line.tsx
 * @description Layout genérico para líneas editoriales con badges.
 */

import React, { memo, useEffect } from 'react';
import MaterialCommunityIcons, {
  type MaterialDesignIconsIconName,
} from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Box, Text } from '@/shared/ui/base';
import { Theme } from '@/shared/theme';

interface BadgeProps {
  icon: MaterialDesignIconsIconName;
  label: string;
}

/**
 * Badge individual memoizado para optimizar el scroll.
 */
const InlineBadge = memo(({ icon, label }: BadgeProps) => {
  const theme = useTheme<Theme>();
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 2000 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      backgroundColor="background"
      paddingHorizontal="s"
      paddingVertical="xs"
      borderRadius="s"
      borderWidth={0.5}
      borderColor="separator"
      marginHorizontal="xs"
      style={{
        alignSelf: 'center',
        shadowColor: theme.colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
      }}
    >
      <Animated.View style={animatedStyle}>
        <MaterialCommunityIcons
          name={icon}
          size={12}
          color={theme.colors.primary}
          style={{ marginRight: 6 }}
        />
      </Animated.View>

      <Text
        variant="caption-md"
        color="textPrimary"
        style={{ fontSize: 10, letterSpacing: 0.5, fontWeight: 'bold' }}
      >
        {label.toUpperCase()}
      </Text>
    </Box>
  );
});

export const ShellFeatureLine = memo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ parts }: { parts: (string | { icon: any; label: string })[] }) => {
    /**
     * Lógica de resaltado de marca Selene.
     */
    const renderStyledText = (text: string) => {
      return text.split(' ').map((word, i) => {
        const isBrand = word.toLowerCase().includes('selene');
        return (
          <Text
            key={i}
            variant="subheader-md"
            color={isBrand ? 'primary' : 'textPrimary'}
            style={{
              lineHeight: 34,
              fontStyle: isBrand ? 'italic' : 'normal',
              fontWeight: isBrand ? 'bold' : 'normal',
            }}
          >
            {word}{' '}
          </Text>
        );
      });
    };

    return (
      <Box
        padding="l"
        borderBottomWidth={1}
        borderBottomColor="separator"
        flexDirection="row"
        flexWrap="wrap"
        alignItems="center"
        justifyContent="center"
      >
        {parts.map((part, index) => (
          <React.Fragment key={index}>
            {typeof part === 'string' ? (
              renderStyledText(part)
            ) : (
              <InlineBadge icon={part.icon} label={part.label} />
            )}
          </React.Fragment>
        ))}
      </Box>
    );
  },
);
