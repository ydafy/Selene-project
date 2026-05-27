/**
 * @file components/features/profile/ProfileSkeleton.tsx
 * @description Estado de carga de alta fidelidad para la pantalla de perfil.
 * Imita la jerarquía visual de ProfileHeader, Wallet y ActionsBar para evitar Layout Shifts.
 */

import React from 'react';
import { Box } from '../../base';
import { Skeleton } from '../../ui/Skeleton';

export const ProfileSkeleton = () => {
  return (
    <Box flex={1} backgroundColor="background" padding="m">
      {/* 1. HEADER CARD (Avatar, Name, Stats) */}
      <Box
        backgroundColor="cardBackground"
        padding="l"
        borderRadius="l"
        alignItems="center"
        marginTop="xl"
        borderWidth={1}
        borderColor="separator"
      >
        {/* Avatar Circle */}
        <Skeleton width={100} height={100} borderRadius={50} />

        {/* Username Placeholder */}
        <Skeleton width="50%" height={28} marginTop="m" borderRadius={4} />

        {/* Badge/Member Date Placeholder */}
        <Skeleton width="40%" height={14} marginTop="s" borderRadius={4} />

        {/* Stats Row Placeholder */}
        <Box
          flexDirection="row"
          marginTop="xl"
          paddingTop="l"
          borderTopWidth={1}
          borderTopColor="separator"
          width="100%"
        >
          <Box flex={1} alignItems="center">
            <Skeleton width={40} height={30} />
            <Skeleton width={50} height={12} marginTop="s" />
          </Box>
          <Box
            width={1}
            backgroundColor="separator"
            height="80%"
            alignSelf="center"
            opacity={0.3}
          />
          <Box flex={1} alignItems="center">
            <Skeleton width={40} height={30} />
            <Skeleton width={50} height={12} marginTop="s" />
          </Box>
          <Box
            width={1}
            backgroundColor="separator"
            height="80%"
            alignSelf="center"
            opacity={0.3}
          />
          <Box flex={1} alignItems="center">
            <Skeleton width={40} height={30} />
            <Skeleton width={50} height={12} marginTop="s" />
          </Box>
        </Box>
      </Box>

      {/* 2. WALLET SECTION PLACEHOLDER */}
      <Box marginTop="m">
        <Skeleton width="100%" height={70} borderRadius="m" />
      </Box>

      {/* 3. ACTIONS BAR PLACEHOLDER (Pedidos, Publicaciones, Direcciones) */}
      <Box marginTop="m">
        <Skeleton width="100%" height={120} borderRadius="l" />
      </Box>

      {/* 4. FAVORITES HEADER & GRID */}
      <Box marginTop="xl" alignItems="center">
        <Skeleton width={30} height={30} borderRadius={15} />
        <Skeleton width="60%" height={14} marginTop="m" borderRadius={4} />
      </Box>
    </Box>
  );
};
