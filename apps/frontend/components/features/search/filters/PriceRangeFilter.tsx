import { TextInput } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { Slider } from '@miblanchard/react-native-slider';

import { Box, Text } from '../../../base';
import { Theme } from '../../../../core/theme';
//import { formatCurrency } from '../../../../core/utils/format';

type PriceRangeFilterProps = {
  currentRange: [number, number];
  onChange: (range: [number, number]) => void;
  min: number;
  max: number;
};

export const PriceRangeFilter = ({
  currentRange,
  onChange,
  min,
  max,
}: PriceRangeFilterProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('search');

  const handleManualChange = (type: 'min' | 'max', text: string) => {
    const numericValue = parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
    const [currentMin, currentMax] = currentRange;

    if (type === 'min') {
      const newMin = Math.min(numericValue, currentMax);
      onChange([newMin, currentMax]);
    } else {
      const newMax = Math.max(numericValue, currentMin);
      onChange([currentMin, newMax]);
    }
  };

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

      {/* Inputs Editables */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        marginBottom="s"
      >
        {/* Input MIN */}
        <Box
          backgroundColor="background"
          padding="s"
          borderRadius="s"
          width="45%"
          borderWidth={1}
          borderColor="cardBackground"
        >
          <Text variant="caption-md" color="textSecondary" marginBottom="xs">
            {t('filters.min')}
          </Text>
          <Box flexDirection="row" alignItems="center">
            <Text color="textPrimary">$</Text>
            <TextInput
              value={String(currentRange[0])}
              onChangeText={(text) => handleManualChange('min', text)}
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

        <Text variant="body-md" color="textSecondary">
          -
        </Text>

        {/* Input MAX */}
        <Box
          backgroundColor="background"
          padding="s"
          borderRadius="s"
          width="45%"
          borderWidth={1}
          borderColor="cardBackground"
        >
          <Text variant="caption-md" color="textSecondary" marginBottom="xs">
            {t('filters.max')}
          </Text>
          <Box flexDirection="row" alignItems="center">
            <Text color="textPrimary">$</Text>
            <TextInput
              value={String(currentRange[1])}
              onChangeText={(text) => handleManualChange('max', text)}
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
      </Box>

      <Box paddingHorizontal="m" marginTop="s">
        <Slider
          value={currentRange}
          onValueChange={(val) => onChange(val as [number, number])}
          minimumValue={min}
          maximumValue={max}
          step={100}
          animateTransitions
          // --- ESTILOS PREMIUM ---

          // 1. Colores
          minimumTrackTintColor={theme.colors.primary} // Parte activa (Lion)
          maximumTrackTintColor={theme.colors.cardBackground} // Parte inactiva (Gris oscuro)
          thumbTintColor={theme.colors.primary}
          // 2. Estilo de la Línea (Track)
          trackStyle={{
            height: 6, // Más gruesa
            borderRadius: 3, // Puntas redondeadas
            backgroundColor: theme.colors.cardBackground, // Asegura que el fondo se vea bien
          }}
          // 3. Estilo del Botón (Thumb)
          thumbStyle={{
            width: 28, // Grande y fácil de tocar
            height: 28,
            borderRadius: 14,
            backgroundColor: theme.colors.primary,
            borderWidth: 4, // Borde grueso
            borderColor: theme.colors.background, // El borde es del color del fondo para crear "espacio"
            // Sombra para elevación
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.5,
            shadowRadius: 4,
            elevation: 5,
          }}
          // 4. Área de toque expandida (Hit Slop invisible)
          containerStyle={{
            height: 40, // Altura del contenedor invisible para facilitar el agarre
          }}
        />
      </Box>
    </Box>
  );
};
