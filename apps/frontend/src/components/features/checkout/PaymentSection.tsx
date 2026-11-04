import React from 'react';
import { Box, Text } from '../../base';
import { PaymentMethodRow } from './PaymentMethodRow';
import { PaymentMethod } from '@selene/types';
import { Skeleton } from '../../ui/Skeleton';

interface PaymentSectionProps {
  method: PaymentMethod | null | undefined;
  onPress: () => void;
  showError: boolean;
  label: string;
  isLoading?: boolean;
}

export const PaymentSection = ({
  method,
  onPress,
  showError,
  label,
  isLoading,
}: PaymentSectionProps) => {
  return (
    <Box marginBottom="l">
      {/* 1. El título siempre fijo (cero parpadeos) */}
      <Text variant="subheader-lg" marginBottom="s" color="primary">
        {label}
      </Text>

      {/* 2. Skeleton Espejo con la silueta exacta de la tarjeta */}
      {isLoading ? (
        <Box
          backgroundColor="cardBackground"
          borderRadius="l"
          padding="m"
          flexDirection="row"
          alignItems="center"
          borderWidth={1}
          borderColor="separator"
        >
          {/* Silueta del logo de la tarjeta */}
          <Skeleton width={38} height={24} borderRadius={4} />

          {/* Silueta del nombre y los 4 dígitos */}
          <Box marginLeft="m" flex={1} gap="xs">
            <Skeleton width="45%" height={14} borderRadius={4} />
            <Skeleton width="25%" height={10} borderRadius={4} />
          </Box>

          {/* Silueta de la flechita */}
          <Skeleton width={14} height={14} borderRadius={7} />
        </Box>
      ) : (
        <PaymentMethodRow
          method={method}
          onPress={onPress}
          error={showError && !method}
        />
      )}
    </Box>
  );
};
