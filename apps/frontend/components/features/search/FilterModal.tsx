/**
 * @file components/features/search/FilterModal.tsx
 * @description Modal de filtrado avanzado con carga dinámica de especificaciones por categoría.
 * Implementa lógica de persistencia temporal y validaciones de integridad de datos (MVP++).
 */

import React, {
  useCallback,
  useMemo,
  useState,
  forwardRef,
  useEffect,
  memo,
} from 'react';
import { ActivityIndicator } from 'react-native-paper';
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

import { Box, Text as ThemedText } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { AppChip } from '../../ui/AppChip';
import { Theme } from '../../../core/theme';
import { useCategoryConfig } from '../search/hooks/useCategoryConfig';
import {
  PRODUCT_CONDITIONS,
  PRICE_LIMITS,
  DEFAULT_MAX_PRICE,
} from '../../../core/constants/product-data';
import { PriceRangeFilter } from './filters/PriceRangeFilter';
import { FilterSection } from './filters/FilterSection';

// Wrapper memoizado para secciones dinámicas de specs.
// Asigna un onToggle estable por specId, desbloqueando memo en FilterSection.
const SpecFilterSection = memo(
  ({
    specId,
    title,
    options,
    selectedValues,
    onToggle,
  }: {
    specId: string;
    title: string;
    options: string[];
    selectedValues: string[];
    onToggle: (specKey: string, value: string) => void;
  }) => {
    const handleToggle = useCallback(
      (value: string) => onToggle(specId, value),
      [onToggle, specId],
    );

    return (
      <FilterSection
        title={title}
        options={options}
        selectedValues={selectedValues}
        onToggle={handleToggle}
      />
    );
  },
);

// --- 1. HELPERS GENÉRICOS (DRY) ---
const toggleFilterItem = <T,>(arr: T[], item: T): T[] =>
  arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item];

export type FilterState = {
  priceRange: [number, number];
  conditions: string[];
  specs: Record<string, string[]>;
};

interface DynamicFilterConfig {
  id: string;
  label: string;
  options: string[];
}

type FilterModalProps = {
  category?: string;
  initialFilters: FilterState;
  onApply: (filters: FilterState) => void;
};

const MIN_PRICE = 0;

export const FilterModal = memo(
  forwardRef<BottomSheetModal, FilterModalProps>(
    ({ category, initialFilters, onApply }, ref) => {
      const theme = useTheme<Theme>();
      const { t } = useTranslation(['search', 'product', 'common']);
      const insets = useSafeAreaInsets();

      const [filters, setFilters] = useState<FilterState>(initialFilters);

      // 1. Carga dinámica desde Supabase
      const {
        data: config,
        isLoading,
        isError,
        refetch,
      } = useCategoryConfig(category || '');

      useEffect(() => {
        setFilters(initialFilters);
      }, [initialFilters]);

      const snapPoints = useMemo(() => ['85%'], []);

      const currentMaxLimit = useMemo(
        () =>
          category && PRICE_LIMITS[category]
            ? PRICE_LIMITS[category]
            : DEFAULT_MAX_PRICE,
        [category],
      );

      // --- 2. HANDLERS REFACTORIZADOS (Clean Code) ---

      const handleClear = useCallback(() => {
        setFilters({
          priceRange: [MIN_PRICE, currentMaxLimit],
          conditions: [],
          specs: {},
        });
      }, [currentMaxLimit]);

      const toggleCondition = useCallback((condition: string) => {
        setFilters((prev) => ({
          ...prev,
          conditions: toggleFilterItem(prev.conditions, condition),
        }));
      }, []);

      const toggleSpec = useCallback((specKey: string, value: string) => {
        setFilters((prev) => ({
          ...prev,
          specs: {
            ...prev.specs,
            [specKey]: toggleFilterItem(prev.specs[specKey] || [], value),
          },
        }));
      }, []);

      const renderBackdrop = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      const renderFooter = useCallback(
        (props: BottomSheetFooterProps) => (
          <BottomSheetFooter {...props} bottomInset={insets.bottom}>
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
                  (ref as React.RefObject<BottomSheetModal>).current?.dismiss();
                }}
              >
                {t('search:filters.apply')}
              </PrimaryButton>
            </Box>
          </BottomSheetFooter>
        ),
        [filters, onApply, ref, t, insets.bottom],
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
        >
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
              <ThemedText variant="header-xl">
                {t('search:filters.title')}
              </ThemedText>
              <AppChip
                label={t('search:filters.clear')}
                variant="outlined"
                onPress={handleClear}
                backgroundColor="cardBackground"
              />
            </Box>
          </Box>

          <BottomSheetScrollView
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.m,
              paddingTop: theme.spacing.m,
              paddingBottom: 120, // Espacio extra para el footer dinámico
            }}
          >
            <PriceRangeFilter
              currentRange={filters.priceRange}
              onChange={(range) =>
                setFilters((prev) => ({ ...prev, priceRange: range }))
              }
              min={MIN_PRICE}
              max={currentMaxLimit}
            />

            <FilterSection
              title={t('search:filters.condition')}
              options={PRODUCT_CONDITIONS}
              selectedValues={filters.conditions}
              onToggle={toggleCondition}
            />

            {/* --- 3. GESTIÓN DE ESTADOS DINÁMICOS (MVP++) --- */}

            {isLoading && (
              <Box padding="xl" alignItems="center">
                <ActivityIndicator color={theme.colors.primary} />
                <ThemedText
                  variant="caption-md"
                  marginTop="m"
                  color="textSecondary"
                >
                  {t('common:states.loading')}
                </ThemedText>
              </Box>
            )}

            {isError && (
              <Box
                padding="m"
                backgroundColor="error"
                borderRadius="m"
                alignItems="center"
              >
                <ThemedText variant="body-sm" color="error">
                  {t('search:filters.error_loading_specs')}
                </ThemedText>
                <AppChip
                  label={t('common:actions.retry')}
                  onPress={() => {
                    refetch();
                  }}
                  style={{ marginTop: theme.spacing.s }}
                />
              </Box>
            )}

            {!isLoading &&
              !isError &&
              (config?.filter_fields as unknown as DynamicFilterConfig[])
                ?.filter((f) => f.options && f.options.length > 0) // Guardia de integridad: solo secciones con opciones
                ?.map((filterConfig) => (
                  <SpecFilterSection
                    key={filterConfig.id}
                    specId={filterConfig.id}
                    title={t(`product:specs.${filterConfig.id}`, {
                      defaultValue: filterConfig.label,
                    })}
                    options={filterConfig.options}
                    selectedValues={filters.specs[filterConfig.id] || []}
                    onToggle={toggleSpec}
                  />
                ))}
          </BottomSheetScrollView>
        </BottomSheetModal>
      );
    },
  ),
);
