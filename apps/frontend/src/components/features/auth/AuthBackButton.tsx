/**
 * @file components/features/auth/AuthBackButton.tsx
 * @description Back button for the auth screens. A normal row inside
 * ScreenLayout, which already applies the safe area.
 */

import React from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';

import { Box } from '../../base';
import { Theme } from '../../../core/theme';

export const AuthBackButton = () => {
  const theme = useTheme<Theme>();
  const router = useRouter();

  return (
    <Box alignSelf="flex-start" paddingLeft="s">
      <IconButton
        icon="arrow-left"
        iconColor={theme.colors.textPrimary}
        size={28}
        onPress={() => router.back()}
      />
    </Box>
  );
};
