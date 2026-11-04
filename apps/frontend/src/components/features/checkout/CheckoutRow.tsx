import React from 'react';
import { Box, Text } from '../../base';

interface CheckoutRowProps {
  label: string;
  value: string | number;
}

/**
 * Reusable row component for checkout summary display
 * @param {string} label - Label for the row (e.g., "Subtotal")
 * @param {string|number} value - Value to display (e.g., "$100")
 */
export const CheckoutRow = ({ label, value }: CheckoutRowProps) => (
  <Box flexDirection="row" justifyContent="space-between" marginBottom="s">
    <Text variant="body-md" color="textSecondary">
      {label}
    </Text>
    <Text variant="body-md" color="textPrimary">
      {value}
    </Text>
  </Box>
);
