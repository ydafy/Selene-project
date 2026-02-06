import React from 'react';
import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { PACKAGE_OPTIONS } from '../../../core/constants/product-data';

type PackageSelectorProps = {
  category: string;
  selectedValue: string;
  onSelect: (value: string) => void;
};

const getIconForPreset = (
  presetId: string,
): keyof typeof MaterialCommunityIcons.glyphMap => {
  if (presetId.includes('envelope')) return 'email-outline';
  if (presetId.includes('ram')) return 'cube-send';
  if (presetId.includes('gpu_1')) return 'package-variant-closed';
  if (presetId.includes('gpu_2')) return 'package-variant';
  if (presetId.includes('mobo')) return 'package-variant';
  return 'package';
};

export const PackageSelector = ({
  category,
  selectedValue,
  onSelect,
}: PackageSelectorProps) => {
  const theme = useTheme<Theme>();
  const options =
    PACKAGE_OPTIONS[category as keyof typeof PACKAGE_OPTIONS] || [];

  return (
    <Box flexDirection="row" gap="m">
      {options.map((preset) => {
        const isSelected = preset.id === selectedValue;
        const iconName = getIconForPreset(preset.id);

        return (
          <TouchableOpacity
            key={preset.id}
            onPress={() => onSelect(preset.id)}
            style={{ flex: 1 }}
          >
            <Box
              padding="m"
              borderRadius="m"
              alignItems="center"
              borderWidth={2}
              borderColor={isSelected ? 'primary' : 'cardBackground'}
              backgroundColor={isSelected ? 'background' : 'cardBackground'}
              height={120} // Altura fija para que todos los botones sean iguales
              justifyContent="center"
            >
              <MaterialCommunityIcons
                name={iconName}
                size={32}
                color={
                  isSelected ? theme.colors.primary : theme.colors.textSecondary
                }
              />
              <Text
                variant="body-sm"
                fontWeight="bold"
                marginTop="s"
                color={isSelected ? 'primary' : 'textSecondary'}
                textAlign="center"
              >
                {preset.label}
              </Text>

              {/* FIX APLICADO AQUÍ */}
              <Text
                variant="caption-md"
                color="textSecondary"
                textAlign="center"
              >
                {`${preset.dimensions.length}x${preset.dimensions.width}x${preset.dimensions.height} cm`}
              </Text>
            </Box>
          </TouchableOpacity>
        );
      })}
    </Box>
  );
};
