/**
 * @file components/features/search/filters/ResultsFilterBar.tsx
 * Versión Final Auditada: Optimizada para scroll y marcas dinámicas.
 */

import React, { memo, useCallback, useMemo } from 'react';
import { ActivityIndicator, ScrollView } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { Box } from '../../../base';
import { AppChip } from '../../../ui/AppChip';
import { BrandCircle } from '../../../ui/BrandCircle';
import { theme, Theme } from '../../../../core/theme';
import { SearchFilters } from '../hooks/useSearchProducts';
import { hasBrandIcon } from '../../../ui/BrandIcon';
import { useCategoryConfig } from '../../search/hooks/useCategoryConfig';

type ResultsFilterBarProps = {
  filters: SearchFilters;
  onUpdate: (newFilters: Partial<SearchFilters>) => void;
  category?: string;
};

interface DynamicFilterConfig {
  id: string;
  label: string;
  options: string[];
}

export const ResultsFilterBar = memo(
  ({ filters, onUpdate, category }: ResultsFilterBarProps) => {
    const theme = useTheme<Theme>();
    const { t } = useTranslation('search');
    const {
      data: config,
      isLoading,
      isError,
    } = useCategoryConfig(category || '');

    const handleSort = useCallback(
      (type: 'newest' | 'price_asc' | 'price_desc') => {
        onUpdate({
          orderBy:
            filters.orderBy === type && type !== 'newest' ? 'newest' : type,
        });
      },
      [filters.orderBy, onUpdate],
    );

    const toggleBrand = useCallback(
      (brand: string) => {
        const currentBrands = filters.specs?.brand || [];
        const newBrands = currentBrands.includes(brand)
          ? currentBrands.filter((b) => b !== brand)
          : [...currentBrands, brand];
        onUpdate({ specs: { ...filters.specs, brand: newBrands } });
      },
      [filters.specs, onUpdate],
    );

    const brandOptions = useMemo(() => {
      // FIX: Casting seguro para habilitar .find()
      const fields = config?.filter_fields as unknown as DynamicFilterConfig[];
      const brandFilterDef = fields?.find((f) => f.id === 'brand');

      return (brandFilterDef?.options || []).filter((brand) =>
        hasBrandIcon(brand),
      );
    }, [config]);

    // --- HELPER DE ESTILO ---
    const getChipProps = (isSelected: boolean) => ({
      // Fondo siempre transparente (se ve el gris de la barra)
      backgroundColor: 'transparent' as keyof Theme['colors'],
      // Texto SIEMPRE blanco (textPrimary), sin importar si está seleccionado o no
      textColor: 'textPrimary' as keyof Theme['colors'],
      variant: 'outlined' as const,
      style: {
        // Borde: Lion si seleccionado, Transparente si no
        borderColor: isSelected ? theme.colors.primary : 'transparent',
        borderWidth: 1,

        height: 40,
        borderRadius: 20,
        paddingHorizontal: 12,
      },
    });

    return (
      <Box
        marginBottom="m"
        backgroundColor="cardBackground"
        borderRadius="m"
        paddingVertical="s"
        style={{
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 4.65,
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 12,
            alignItems: 'center',
          }}
        >
          <AppChip
            label={t('filters.sortNewest')}
            selected={filters.orderBy === 'newest' || !filters.orderBy}
            onPress={() => handleSort('newest')}
            {...getChipProps(filters.orderBy === 'newest' || !filters.orderBy)}
          />
          <Box marginLeft="s">
            <AppChip
              label={t('filters.sortPriceLow')}
              selected={filters.orderBy === 'price_asc'}
              icon={filters.orderBy === 'price_asc' ? 'arrow-up' : undefined}
              onPress={() => handleSort('price_asc')}
              {...getChipProps(filters.orderBy === 'price_asc')}
            />
          </Box>
          <Box marginLeft="s">
            <AppChip
              label={t('filters.sortPriceHigh')}
              selected={filters.orderBy === 'price_desc'}
              icon={filters.orderBy === 'price_desc' ? 'arrow-down' : undefined}
              onPress={() => handleSort('price_desc')}
              {...getChipProps(filters.orderBy === 'price_desc')}
            />
          </Box>
          <Box marginLeft="s">
            <AppChip
              label={t('filters.verifiedOnly')}
              selected={!!filters.verifiedOnly}
              icon={filters.verifiedOnly ? 'shield-check' : undefined}
              onPress={() => onUpdate({ verifiedOnly: !filters.verifiedOnly })}
              {...getChipProps(!!filters.verifiedOnly)}
            />
          </Box>

          {/* DIVIDER DINÁMICO */}
          {!isLoading && !isError && brandOptions.length > 0 && (
            <Box
              width={1}
              height={20}
              backgroundColor="textSecondary"
              marginHorizontal="m"
              opacity={0.3}
            />
          )}

          {/* RENDER DE MARCAS CON GUARDIA DE CARGA */}
          {isLoading ? (
            <Box marginLeft="m">
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </Box>
          ) : (
            brandOptions.map((brand) => (
              <BrandCircle
                key={brand}
                brandName={brand}
                isSelected={!!filters.specs?.brand?.includes(brand)}
                onPress={() => toggleBrand(brand)}
              />
            ))
          )}
        </ScrollView>

        <LinearGradient
          colors={['transparent', theme.colors.cardBackground]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.rightGradient}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[theme.colors.cardBackground, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.leftGradient}
          pointerEvents="none"
        />
      </Box>
    );
  },
);

const styles = {
  chip: {
    height: 40,
    borderRadius: 90,
    paddingHorizontal: 12,
    borderColor: 'transparent',
  },
  rightGradient: {
    position: 'absolute' as const,
    right: 0,
    top: 0,
    bottom: 0,
    width: 20, // Ancho del desvanecimiento (ajustable)
    borderTopRightRadius: theme.borderRadii.l, // Respetar bordes redondeados
    borderBottomRightRadius: theme.borderRadii.l,
  },
  leftGradient: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    width: 15,
    borderTopLeftRadius: theme.borderRadii.l,
    borderBottomLeftRadius: theme.borderRadii.l,
  },
};
