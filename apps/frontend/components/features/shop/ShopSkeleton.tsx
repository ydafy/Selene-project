import React from 'react';
import { Box } from '../../base';
import { Skeleton } from '../../ui/Skeleton';

export const ShopSkeleton = ({ visibleHeight }: { visibleHeight: number }) => {
  const stripHeight = visibleHeight / 4;
  return (
    <Box height={visibleHeight}>
      {[...Array(4)].map((_, i) => (
        <Box
          key={i}
          height={stripHeight}
          borderBottomWidth={i === 3 ? 0 : 1}
          borderColor="separator"
          padding="l"
          justifyContent="center"
        >
          <Skeleton
            width="40%"
            height={30}
            borderRadius={8}
            style={{ opacity: 0.1 }}
          />
          <Skeleton
            width="20%"
            height={2}
            marginTop="s"
            style={{ opacity: 0.1 }}
          />
        </Box>
      ))}
    </Box>
  );
};
