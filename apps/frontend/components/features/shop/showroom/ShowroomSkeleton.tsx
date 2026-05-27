/**
 * @file components/features/shop/showroom/ShowroomSkeleton.tsx
 * @description Esqueleto de carga para la pantalla editorial.
 */

import React from 'react';
import { Dimensions } from 'react-native';
import { Box } from '../../../../components/base';
import { Skeleton } from '../../../../components/ui/Skeleton';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_HEIGHT * 0.6;

export const ShowroomSkeleton = () => {
  return (
    <Box flex={1} backgroundColor="background">
      {/* Hero Skeleton */}
      <Skeleton width="100%" height={HERO_HEIGHT} borderRadius={0} />

      {/* Content Skeleton */}
      <Box padding="l" gap="m">
        <Skeleton width="70%" height={35} borderRadius={8} />
        <Skeleton width="50%" height={20} borderRadius={4} />

        {/* Insights Skeleton */}
        <Box flexDirection="row" marginTop="m" gap="m">
          <Skeleton width={280} height={220} borderRadius={16} />
          <Skeleton width={100} height={220} borderRadius={16} />
        </Box>

        {/* Filter Bar Skeleton */}
        <Box marginTop="l">
          <Skeleton width="100%" height={50} borderRadius={25} />
        </Box>

        {/* Grid Skeletons */}
        <Box flexDirection="row" justifyContent="space-between" marginTop="l">
          <Skeleton width="48%" height={200} borderRadius={12} />
          <Skeleton width="48%" height={200} borderRadius={12} />
        </Box>
      </Box>
    </Box>
  );
};
