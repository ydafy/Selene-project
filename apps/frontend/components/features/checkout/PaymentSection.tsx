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
  isLoading?: boolean; // Prop añadida
}

export const PaymentSection = ({
  method,
  onPress,
  showError,
  label,
  isLoading,
}: PaymentSectionProps) => {
  if (isLoading) {
    return (
      <Box marginBottom="l">
        <Skeleton width={150} height={20} borderRadius={4} />
        <Box marginTop="s">
          <Skeleton width="100%" height={70} borderRadius={12} />
        </Box>
      </Box>
    );
  }
  return (
    <Box marginBottom="l">
      <Text variant="subheader-lg" marginBottom="s" color="primary">
        {label}
      </Text>
      <PaymentMethodRow
        method={method}
        onPress={onPress}
        error={showError && !method}
      />
    </Box>
  );
};
