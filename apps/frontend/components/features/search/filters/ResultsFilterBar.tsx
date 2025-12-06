import { ScrollView } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';

import { Box } from '../../../base';
import { AppChip } from '../../../ui/AppChip';
import { BrandCircle } from '../../../ui/BrandCircle';
import { Theme } from '../../../../core/theme';
import { FILTERS_BY_CATEGORY } from '../../../../core/constants/product-data';
import { SearchFilters } from '../hooks/useSearchProducts';
import { hasBrandIcon } from '../../../ui/BrandIcon';
import { LinearGradient } from 'expo-linear-gradient';

type ResultsFilterBarProps = {
  filters: SearchFilters;
  onUpdate: (newFilters: Partial<SearchFilters>) => void;
  category?: string;
};

export const ResultsFilterBar = ({
  filters,
  onUpdate,
  category,
}: ResultsFilterBarProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('search');
  const gradientColor = theme.colors.cardBackground;

  // Lógica para alternar ordenamiento
  const handleSort = (type: 'newest' | 'price_asc' | 'price_desc') => {
    // Si toco el que ya está activo y NO es 'newest', lo desactivo (vuelvo a default)
    if (filters.orderBy === type && type !== 'newest') {
      onUpdate({ orderBy: 'newest' });
    } else {
      onUpdate({ orderBy: type });
    }
  };

  const categoryConfig = category ? FILTERS_BY_CATEGORY[category] : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brandFilterDef = categoryConfig?.find((f: any) => f.id === 'brand');

  const brandOptions: string[] = (brandFilterDef?.options || []).filter(
    (brand: string) => hasBrandIcon(brand),
  );

  const toggleBrand = (brand: string) => {
    const currentBrands = filters.specs?.brand || [];
    const exists = currentBrands.includes(brand);
    const newBrands = exists
      ? currentBrands.filter((b) => b !== brand)
      : [...currentBrands, brand];

    onUpdate({
      specs: { ...filters.specs, brand: newBrands },
    });
  };

  // --- HELPER DE ESTILO (DISEÑO FINAL) ---
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
      paddingHorizontal: 12, // Espacio lateral extra
    },
  });

  return (
    <Box
      marginBottom="m"
      backgroundColor="cardBackground"
      borderRadius="m"
      paddingVertical="s"
      position="relative"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4.65,
        elevation: 8,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'center' }}
      >
        {/* 1. CHIPS DE ORDENAMIENTO Y ESTADO */}

        {/* Recientes */}
        <AppChip
          label={t('filters.sortNewest')}
          selected={filters.orderBy === 'newest' || !filters.orderBy}
          onPress={() => handleSort('newest')}
          {...getChipProps(filters.orderBy === 'newest' || !filters.orderBy)}
        />

        {/* Precio: Menor a Mayor */}
        <Box marginLeft="s">
          <AppChip
            label={t('filters.sortPriceLow')}
            selected={filters.orderBy === 'price_asc'}
            icon={filters.orderBy === 'price_asc' ? 'arrow-up' : undefined}
            onPress={() => handleSort('price_asc')}
            {...getChipProps(filters.orderBy === 'price_asc')}
          />
        </Box>

        {/* Precio: Mayor a Menor */}
        <Box marginLeft="s">
          <AppChip
            label={t('filters.sortPriceHigh')}
            selected={filters.orderBy === 'price_desc'}
            icon={filters.orderBy === 'price_desc' ? 'arrow-down' : undefined}
            onPress={() => handleSort('price_desc')}
            {...getChipProps(filters.orderBy === 'price_desc')}
          />
        </Box>

        {/* Verificados */}
        <Box marginLeft="s">
          <AppChip
            label={t('filters.verifiedOnly')}
            selected={!!filters.verifiedOnly}
            icon={filters.verifiedOnly ? 'shield-check' : undefined}
            onPress={() => onUpdate({ verifiedOnly: !filters.verifiedOnly })}
            {...getChipProps(!!filters.verifiedOnly)}
          />
        </Box>

        {/* 2. SEPARADOR VERTICAL */}
        {brandOptions.length > 0 && (
          <Box
            width={1}
            height={20}
            backgroundColor="textSecondary"
            marginHorizontal="m"
            alignSelf="center"
            opacity={0.3}
          />
        )}

        {/* 3. CÍRCULOS DE MARCA */}
        {brandOptions.map((brand) => {
          const isSelected = filters.specs?.brand?.includes(brand);
          return (
            <BrandCircle
              key={brand}
              brandName={brand}
              isSelected={!!isSelected}
              onPress={() => toggleBrand(brand)}
            />
          );
        })}
      </ScrollView>

      <LinearGradient
        // De transparente a Color de Fondo
        colors={['transparent', gradientColor]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }} // Gradiente Horizontal
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 20, // Ancho del desvanecimiento (ajustable)
          borderTopRightRadius: theme.borderRadii.l, // Respetar bordes redondeados
          borderBottomRightRadius: theme.borderRadii.l,
        }}
        pointerEvents="none" // CRUCIAL: Deja pasar los toques a través del gradiente
      />

      {/* Opcional: También a la izquierda si quieres simular profundidad al scrollear */}

      <LinearGradient
        colors={[gradientColor, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 15,
          borderTopLeftRadius: theme.borderRadii.l,
          borderBottomLeftRadius: theme.borderRadii.l,
        }}
        pointerEvents="none"
      />
    </Box>
  );
};
