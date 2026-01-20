/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useMemo, useState, forwardRef, useEffect } from 'react';
//import { StyleSheet } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetFooter,
  BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { AppChip } from '../../ui/AppChip';
import { Theme } from '../../../core/theme';
import {
  FILTERS_BY_CATEGORY,
  PRODUCT_CONDITIONS,
  PRICE_LIMITS,
  DEFAULT_MAX_PRICE,
} from '../../../core/constants/product-data';

// Nuevos Componentes
import { PriceRangeFilter } from './filters/PriceRangeFilter';
import { FilterSection } from './filters/FilterSection';

export type FilterState = {
  priceRange: [number, number];
  conditions: string[];
  specs: Record<string, string[]>;
};

type FilterModalProps = {
  category?: string;
  initialFilters: FilterState;
  onApply: (filters: FilterState) => void;
};

const MIN_PRICE = 0;

export const FilterModal = forwardRef<BottomSheetModal, FilterModalProps>(
  ({ category, initialFilters, onApply }, ref) => {
    const theme = useTheme<Theme>();
    const { t } = useTranslation(['search', 'product', 'common']);
    const insets = useSafeAreaInsets();

    const [filters, setFilters] = useState<FilterState>(initialFilters);

    useEffect(() => {
      setFilters(initialFilters);
    }, [initialFilters]);

    const snapPoints = useMemo(() => ['85%'], []);

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.7}
          pressBehavior="close"
        />
      ),
      [],
    );

    // --- HANDLERS ---
    const handleClear = () => {
      setFilters({
        priceRange: [MIN_PRICE, currentMaxLimit],
        conditions: [],
        specs: {},
      });
    };

    const toggleCondition = (condition: string) => {
      setFilters((prev) => {
        const exists = prev.conditions.includes(condition);
        return {
          ...prev,
          conditions: exists
            ? prev.conditions.filter((c) => c !== condition)
            : [...prev.conditions, condition],
        };
      });
    };

    const toggleSpec = (specKey: string, value: string) => {
      setFilters((prev) => {
        const currentValues = prev.specs[specKey] || [];
        const exists = currentValues.includes(value);
        const newValues = exists
          ? currentValues.filter((v) => v !== value)
          : [...currentValues, value];

        return {
          ...prev,
          specs: {
            ...prev.specs,
            [specKey]: newValues,
          },
        };
      });
    };

    const currentMaxLimit =
      category && PRICE_LIMITS[category]
        ? PRICE_LIMITS[category]
        : DEFAULT_MAX_PRICE;
    const dynamicFilters = category ? FILTERS_BY_CATEGORY[category] : [];

    // --- FOOTER ---
    const renderFooter = useCallback(
      (props: BottomSheetFooterProps) => (
        <BottomSheetFooter {...props} bottomInset={0}>
          <Box
            padding="m"
            paddingBottom="xl"
            backgroundColor="cardBackground"
            borderTopWidth={1}
            borderTopColor="background"
          >
            <PrimaryButton
              onPress={() => {
                onApply(filters);
                (ref as any).current?.dismiss();
              }}
            >
              {t('search:filters.apply')}
            </PrimaryButton>
          </Box>
        </BottomSheetFooter>
      ),
      [filters, onApply, ref, theme, t],
    );

    return (
      <BottomSheetModal
        ref={ref}
        index={0}
        snapPoints={snapPoints}
        topInset={insets.top}
        backdropComponent={renderBackdrop}
        footerComponent={renderFooter}
        backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
        enablePanDownToClose={true}
        android_keyboardInputMode="adjustResize"
      >
        {/* HEADER */}
        <Box
          paddingHorizontal="m"
          paddingBottom="m"
          borderBottomWidth={1}
          borderBottomColor="background"
        >
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Text variant="header-xl">{t('search:filters.title')}</Text>
            <AppChip
              label={t('search:filters.clear')}
              variant="outlined"
              onPress={handleClear}
              backgroundColor="cardBackground"
            />
          </Box>
        </Box>

        {/* CONTENIDO */}
        <BottomSheetScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.m,
            paddingTop: theme.spacing.m,
            paddingBottom: 100,
          }}
        >
          {/* 1. Componente de Precio */}
          <PriceRangeFilter
            currentRange={filters.priceRange}
            onChange={(range) =>
              setFilters((prev) => ({ ...prev, priceRange: range }))
            }
            min={MIN_PRICE}
            max={currentMaxLimit}
          />

          {/* 2. Componente de Condición */}
          <FilterSection
            title={t('search:filters.condition')}
            options={PRODUCT_CONDITIONS}
            selectedValues={filters.conditions}
            onToggle={toggleCondition}
          />

          {/* 3. Componentes Dinámicos (Specs) */}
          {dynamicFilters?.map((filterConfig: any) => (
            <FilterSection
              key={filterConfig.id}
              title={t(`product:specs.${filterConfig.id}`, {
                defaultValue: filterConfig.label,
              })}
              options={filterConfig.options}
              selectedValues={filters.specs[filterConfig.id] || []}
              onToggle={(val) => toggleSpec(filterConfig.id, val)}
            />
          ))}
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);
