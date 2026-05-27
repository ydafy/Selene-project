import React, { memo, useCallback } from 'react';
import { TextInput } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { Slider } from '@miblanchard/react-native-slider';

import { Box, Text } from '../../../base';
import { Theme } from '../../../../core/theme';

const CURRENCY_SYMBOL = '$';

type PriceInputProps = {
  label: string;
  value: number;
  onChangeText: (text: string) => void;
};

const PriceInput = memo(({ label, value, onChangeText }: PriceInputProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box
      backgroundColor="background"
      padding="s"
      borderRadius="s"
      width="45%"
      borderWidth={1}
      borderColor="cardBackground"
    >
      <Text variant="caption-md" color="textSecondary" marginBottom="xs">
        {label}
      </Text>
      <Box flexDirection="row" alignItems="center">
        <Text color="textPrimary">{CURRENCY_SYMBOL}</Text>
        <TextInput
          value={String(value)}
          onChangeText={onChangeText}
          keyboardType="numeric"
          style={{
            color: theme.colors.textPrimary,
            fontFamily: 'Montserrat-Bold',
            fontSize: 16,
            flex: 1,
            marginLeft: 4,
          }}
        />
      </Box>
    </Box>
  );
});

type PriceRangeFilterProps = {
  currentRange: [number, number];
  onChange: (range: [number, number]) => void;
  min: number;
  max: number;
};

const PriceRangeFilterComponent = ({
  currentRange,
  onChange,
  min,
  max,
}: PriceRangeFilterProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('search');

  const handleMinChange = useCallback(
    (text: string) => {
      const numericValue = parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
      const [currentMax] = currentRange;
      onChange([Math.min(numericValue, currentMax), currentMax]);
    },
    [currentRange, onChange],
  );

  const handleMaxChange = useCallback(
    (text: string) => {
      const numericValue = parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
      const [currentMin] = currentRange;
      onChange([currentMin, Math.max(numericValue, currentMin)]);
    },
    [currentRange, onChange],
  );

  return (
    <Box marginBottom="xl">
      <Text
        variant="subheader-md"
        color="primary"
        style={{ textTransform: 'uppercase', letterSpacing: 1 }}
        marginBottom="m"
      >
        {t('filters.priceRange')}
      </Text>

      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        marginBottom="s"
      >
        <PriceInput
          label={t('filters.min')}
          value={currentRange[0]}
          onChangeText={handleMinChange}
        />

        <Text variant="body-md" color="textSecondary">
          -
        </Text>

        <PriceInput
          label={t('filters.max')}
          value={currentRange[1]}
          onChangeText={handleMaxChange}
        />
      </Box>

      <Box paddingHorizontal="m" marginTop="s">
        <Slider
          value={currentRange}
          onValueChange={(val) => onChange(val as [number, number])}
          minimumValue={min}
          maximumValue={max}
          step={100}
          animateTransitions
          minimumTrackTintColor={theme.colors.primary}
          maximumTrackTintColor={theme.colors.cardBackground}
          thumbTintColor={theme.colors.primary}
          trackStyle={{
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.colors.cardBackground,
          }}
          thumbStyle={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: theme.colors.primary,
            borderWidth: 4,
            borderColor: theme.colors.background,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.5,
            shadowRadius: 4,
            elevation: 5,
          }}
          containerStyle={{
            height: 40,
          }}
        />
      </Box>
    </Box>
  );
};

export const PriceRangeFilter = memo(PriceRangeFilterComponent);
