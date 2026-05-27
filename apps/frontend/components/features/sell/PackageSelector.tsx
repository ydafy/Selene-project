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

// Íconos visuales basados en la categoría o ID
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
  const { t } = useTranslation('common');

  // Filtramos los presets que corresponden a la categoría actual
  const options = useMemo(() => {
    if (!settings?.package_presets) return [];

    // Casting seguro del JSONB
    const presets = settings.package_presets as unknown as PackagePresetsMap;

    return Object.keys(presets)
      .filter((key) => presets[key].category === category)
      .map((key) => ({
        id: key, // La llave del JSON se convierte en el ID para React
        ...presets[key],
      }));
  }, [settings?.package_presets, category]);

  // Estado de carga
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
          {t('states.loading', 'Cargando...')}
        </Text>
      </Box>
    );
  }

  // Fallback si la categoría no tiene cajas configuradas en la DB
  if (options.length === 0) {
    return (
      <Box padding="m" backgroundColor="error" borderRadius="m">
        <Text variant="body-md" color="error">
          {t(
            'errors.noPackages',
            'No hay opciones de empaque para esta categoría.',
          )}
        </Text>
      </Box>
    );
  }

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
