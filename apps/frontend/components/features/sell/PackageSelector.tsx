import React, { useMemo } from 'react';
import { TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import {
  useSystemConfig,
  PackagePresetsMap,
} from '../../../core/hooks/useSystemConfig';
import { useTranslation } from 'react-i18next';

type PackageSelectorProps = {
  category: string;
  selectedValue: string;
  onSelect: (value: string) => void;
};

const getIconForPreset = (
  presetId: string,
): keyof typeof MaterialCommunityIcons.glyphMap => {
  if (presetId.includes('ram')) return 'cube-send';
  if (presetId.includes('gpu_1')) return 'package-variant-closed';
  if (presetId.includes('gpu_2')) return 'package-variant';
  if (presetId.includes('mobo')) return 'package-variant';
  if (presetId.includes('cpu')) return 'cube-outline';
  return 'package';
};

export const PackageSelector = ({
  category,
  selectedValue,
  onSelect,
}: PackageSelectorProps) => {
  const theme = useTheme<Theme>();
  const { data: settings, isLoading } = useSystemConfig();
  const { t } = useTranslation(['common', 'sell']);

  const options = useMemo(() => {
    if (!settings?.package_presets) return [];

    const presets = settings.package_presets as unknown as PackagePresetsMap;

    return Object.keys(presets)
      .filter((key) => presets[key].category === category)
      .map((key) => ({
        id: key,
        ...presets[key],
      }));
  }, [settings?.package_presets, category]);

  if (isLoading) {
    return (
      <Box
        height={120}
        justifyContent="center"
        alignItems="center"
        backgroundColor="cardBackground"
        borderRadius="m"
        borderWidth={1}
        borderColor="separator"
      >
        <ActivityIndicator color={theme.colors.primary} />
        <Text variant="caption-md" color="textSecondary" marginTop="s">
          {t('common:states.loading')}
        </Text>
      </Box>
    );
  }

  // Fallback corregido: Texto legible sobre fondo de error
  if (options.length === 0) {
    return (
      <Box padding="m" backgroundColor="error" borderRadius="m">
        <Text
          variant="body-md"
          color="textPrimary"
          fontWeight="bold"
          textAlign="center"
        >
          {t('common:errors.noPackages')}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexWrap="wrap" gap="m">
      {options.map((preset) => {
        const isSelected = preset.id === selectedValue;
        const iconName = getIconForPreset(preset.id);

        return (
          <TouchableOpacity
            key={preset.id}
            onPress={() => onSelect(preset.id)}
            accessibilityRole="button"
            accessibilityLabel={t('sell:a11y.packageOption', {
              label: preset.label,
              dimensions: `${preset.length}x${preset.width}x${preset.height} cm`,
            })}
            accessibilityState={{ selected: isSelected }}
            style={{ flex: options.length > 2 ? 0 : 1, minWidth: '45%' }}
          >
            <Box
              padding="m"
              borderRadius="m"
              alignItems="center"
              borderWidth={2}
              borderColor={isSelected ? 'primary' : 'background'}
              backgroundColor={isSelected ? 'background' : 'cardBackground'}
              height={120}
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
              <Text
                variant="caption-md"
                color="textSecondary"
                textAlign="center"
                marginTop="xs"
              >
                {`${preset.length}x${preset.width}x${preset.height} cm`}
              </Text>
            </Box>
          </TouchableOpacity>
        );
      })}
    </Box>
  );
};
