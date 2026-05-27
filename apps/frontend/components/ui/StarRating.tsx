import React from 'react';
import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box } from '../base';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../core/theme';
import * as Haptics from 'expo-haptics';

interface Props {
  rating: number;
  onRatingChange?: (rating: number) => void;
  size?: number;
  interactive?: boolean;
}

export const StarRating = ({
  rating,
  onRatingChange,
  size = 32,
  interactive = true,
}: Props) => {
  const theme = useTheme<Theme>();

  const handlePress = (index: number) => {
    if (!interactive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRatingChange?.(index);
  };

  return (
    <Box flexDirection="row" gap="s" justifyContent="center">
      {[1, 2, 3, 4, 5].map((i) => (
        <TouchableOpacity
          key={i}
          onPress={() => handlePress(i)}
          disabled={!interactive}
          activeOpacity={interactive ? 0.7 : 1}
        >
          <MaterialCommunityIcons
            name={i <= rating ? 'star' : 'star-outline'}
            size={size}
            color={
              i <= rating ? theme.colors.primary : theme.colors.textSecondary
            }
          />
        </TouchableOpacity>
      ))}
    </Box>
  );
};
