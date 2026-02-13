import React from 'react';
import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { Address } from '@selene/types';
import { Theme } from '../../../core/theme';
import { Skeleton } from '../../ui/Skeleton';

interface AddressSectionProps {
  address: Address | null;
  onPress: () => void;
  showError: boolean;
  label: string;
  placeholder: string;
  isLoading?: boolean;
}

export const AddressSection = ({
  address,
  onPress,
  showError,
  label,
  placeholder,
  isLoading,
}: AddressSectionProps) => {
  const theme = useTheme<Theme>();

  if (isLoading) {
    return (
      <Box marginBottom="l">
        <Skeleton width={120} height={20} borderRadius={4} />
        <Box marginTop="s">
          <Skeleton width="100%" height={80} borderRadius={12} />
        </Box>
      </Box>
    );
  }

  return (
    <Box marginBottom="l">
      <Text variant="subheader-lg" marginBottom="s" color="primary">
        {label}
      </Text>
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        <Box
          backgroundColor="cardBackground"
          padding="m"
          borderRadius="m"
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          borderWidth={1}
          borderColor={showError && !address ? 'error' : 'background'}
        >
          <Box flex={1} flexDirection="row" alignItems="center">
            <MaterialCommunityIcons
              name="map-marker-outline"
              size={24}
              color={theme.colors.primary}
            />
            <Box marginLeft="m">
              {address ? (
                <>
                  <Text variant="body-md" fontWeight="bold">
                    {address.full_name}
                  </Text>
                  <Text
                    variant="caption-md"
                    color="textSecondary"
                    numberOfLines={1}
                  >
                    {address.street_line1}, {address.city}
                  </Text>
                </>
              ) : (
                <Text variant="body-md" color="textSecondary">
                  {placeholder}
                </Text>
              )}
            </Box>
          </Box>
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={theme.colors.textSecondary}
          />
        </Box>
      </TouchableOpacity>
    </Box>
  );
};
