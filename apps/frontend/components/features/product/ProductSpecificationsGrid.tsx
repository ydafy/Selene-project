import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { BrandIcon } from '../../ui/BrandIcon'; // <-- Importamos la fábrica

type ProductSpecificationsProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  specs: Record<string, any>;
};

export const ProductSpecificationsGrid = ({
  specs,
}: ProductSpecificationsProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('product');

  if (!specs || Object.keys(specs).length === 0) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatValue = (value: any) => {
    if (value === true) return t('yes');
    if (value === false) return t('no');
    return String(value);
  };

  return (
    <Box marginTop="l">
      <Text variant="subheader-lg" marginBottom="m" color="primary">
        {t('product:details.specifications')}
      </Text>

      {/* Contenedor Grid */}
      <Box flexDirection="row" flexWrap="wrap" style={{ gap: 10 }}>
        {Object.entries(specs).map(([key, value]) => {
          const labelKey = `specs.${key}`;
          const label = t(labelKey, { defaultValue: key });

          // Lógica para detectar si lleva icono
          const isBrandKey = key === 'brand' || key === 'chipset';
          const brandName = String(value);

          return (
            <Box
              key={key}
              style={[
                styles.gridItem,
                {
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.background,
                },
              ]}
              padding="m"
              borderRadius="m"
              borderWidth={1}
            >
              {/* Etiqueta (Arriba) */}
              <Text
                variant="caption-md"
                color="textPrimary"
                style={styles.label}
                marginBottom="xs"
              >
                {label}
              </Text>

              {/* Contenedor Valor + Icono (Abajo) */}
              <Box
                flexDirection="row"
                alignItems="center"
                justifyContent="flex-start"
              >
                <Text
                  variant="body-lg"
                  color="textPrimary"
                  style={[styles.value, { flexShrink: 1 }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {formatValue(value)}
                </Text>

                {/* 1. Icono (A la izquierda del valor para mejor lectura visual) */}
                {isBrandKey && (
                  <Box marginLeft="m">
                    {/* Usamos size={20} porque nuestros iconos ya escalan bien */}
                    <BrandIcon name={brandName} size={20} />
                  </Box>
                )}

                {/* 2. Valor de Texto */}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  gridItem: {
    width: '48%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 4.65,
    elevation: 8,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 10,
  },
  value: {
    fontFamily: 'Montserrat-Bold',
  },
});
