import { ScrollView, TouchableOpacity } from 'react-native';
//import { useTheme } from '@shopify/restyle';
import { Box } from '../../base';
//import { Theme } from '../../../core/theme';
import { BrandIcon } from '../../ui/BrandIcon';

type ProductBrandBarProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  specs: Record<string, any>;
};

// Las claves que queremos extraer para mostrar como "Tags" destacados
const TARGET_KEYS = ['brand', 'chipset'];

export const ProductBrandBar = ({ specs }: ProductBrandBarProps) => {
  //const theme = useTheme<Theme>();

  // 1. Filtramos las specs para encontrar solo las marcas
  const brandsFound = Object.entries(specs).filter(([key]) =>
    TARGET_KEYS.includes(key),
  );

  if (brandsFound.length === 0) return null;

  return (
    <Box marginBottom="m">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {brandsFound.map(([key, value]) => {
          const brandName = String(value);

          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.7}
              onPress={() => console.log(`Navegar a filtro de: ${brandName}`)}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                backgroundColor="cardBackground"
                paddingVertical="s"
                paddingHorizontal="m"
                borderRadius="full" // Píldora perfecta
                marginRight="s"
                borderWidth={1}
                borderColor="background"
                style={{
                  // Sombra sutil para que flote
                  elevation: 2,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 2,
                }}
              >
                {/* El Icono (Factory) */}
                <Box marginRight="s">
                  <BrandIcon name={brandName} size={18} />
                </Box>
              </Box>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </Box>
  );
};
