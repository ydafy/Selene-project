/**
 * @file components/features/home/HomeSkeleton.tsx
 * @description Esqueleto de carga sincronizado con las dimensiones reales de las secciones.
 */

import React from 'react';
import { Dimensions } from 'react-native';
import { Box } from '../../base';
import { Skeleton } from '../../ui/Skeleton';
import { GridShell } from './GridShell';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Props {
  rank: 'EXPLORER' | 'VETERAN';
}

export const HomeSkeleton = ({ rank }: Props) => {
  // Ajustamos el color base del skeleton para que sea sutil en Dark Mode
  const skeletonStyle = { backgroundColor: 'rgba(255, 255, 255, 0.08)' };

  if (rank === 'EXPLORER') {
    return (
      <GridShell>
        {/* 1. Hero Text Slot */}
        <Box padding="xl" alignItems="center" gap="s">
          <Skeleton width="90%" height={35} style={skeletonStyle} />
          <Skeleton width="70%" height={35} style={skeletonStyle} />
          <Skeleton width="60%" height={20} style={skeletonStyle} />
        </Box>

        {/* 2. Hero Visual Slot */}
        <Box
          height={320}
          width="100%"
          justifyContent="center"
          alignItems="center"
        >
          <Skeleton
            width="80%"
            height="80%"
            borderRadius={20}
            style={skeletonStyle}
          />
        </Box>

        {/* 3. Hero Action Slot */}
        <Box
          padding="l"
          alignItems="center"
          borderBottomWidth={2}
          borderBottomColor="separator"
        >
          <Skeleton
            width="100%"
            height={48}
            borderRadius={12}
            style={skeletonStyle}
          />
          <Skeleton
            width="40%"
            height={15}
            marginTop="m"
            style={skeletonStyle}
          />
        </Box>
      </GridShell>
    );
  }

  return (
    <GridShell>
      {/* 1. Recently Viewed Slot */}
      <Box padding="l" borderBottomWidth={1} borderBottomColor="separator">
        <Skeleton
          width="40%"
          height={15}
          marginBottom="s"
          style={skeletonStyle}
        />
        <Skeleton
          width="60%"
          height={30}
          marginBottom="l"
          style={skeletonStyle}
        />

        <Box flexDirection="row" gap="m">
          <Skeleton
            width={160}
            height={220}
            borderRadius={16}
            style={skeletonStyle}
          />
          <Skeleton
            width={160}
            height={180}
            borderRadius={16}
            style={skeletonStyle}
          />
        </Box>
      </Box>

      {/* 2. Editorial Slot */}
      <Box padding="l" borderBottomWidth={1} borderBottomColor="separator">
        <Box flexDirection="row" gap="m">
          <Skeleton
            width={SCREEN_WIDTH * 0.85}
            height={160}
            borderRadius={24}
            style={skeletonStyle}
          />
        </Box>
      </Box>
    </GridShell>
  );
};
