import { TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { MotiView } from 'moti';
import { Box, Text } from '../base';
import { Theme } from '../../core/theme';

type SegmentedControlProps = {
  options: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  // NUEVA PROP: Array de booleanos para mostrar puntos rojos
  // Ejemplo: [false, true] -> Muestra punto en la segunda opción
  badges?: boolean[];
};

export const SegmentedControl = ({
  options,
  selectedIndex,
  onChange,
  badges,
}: SegmentedControlProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box
      flexDirection="row"
      backgroundColor="cardBackground"
      borderRadius="full"
      padding="xs"
      height={44}
    >
      {options.map((option, index) => {
        const isSelected = index === selectedIndex;
        const showBadge = badges?.[index]; // Verificamos si esta tab lleva badge

        return (
          <TouchableOpacity
            key={option}
            onPress={() => onChange(index)}
            style={{ flex: 1 }}
            activeOpacity={0.8}
          >
            <MotiView
              from={{ backgroundColor: 'transparent' }}
              animate={{
                backgroundColor: isSelected
                  ? theme.colors.primary
                  : 'transparent',
              }}
              transition={{
                type: 'timing',
                duration: 200,
              }}
              style={[styles.itemContainer, isSelected && styles.shadow]}
            >
              {/* Contenedor relativo para texto y badge */}
              <Box flexDirection="row" alignItems="center">
                <Text
                  variant="body-sm"
                  fontWeight="bold"
                  style={{
                    color: isSelected
                      ? theme.colors.primary
                      : theme.colors.textSecondary,
                  }}
                >
                  {option}
                </Text>

                {/* EL BADGE (PUNTO ROJO) */}
                {showBadge && (
                  <Box
                    marginLeft="s" // Separación del texto
                    width={6}
                    height={6}
                    borderRadius="full"
                    backgroundColor="error" // Usa el color de error del tema
                    style={{
                      // Si la tab está seleccionada, el punto rojo resalta sobre el dorado
                      // Si no, resalta sobre el gris.
                      borderWidth: 1,
                      borderColor: isSelected
                        ? theme.colors.primary
                        : theme.colors.cardBackground,
                    }}
                  />
                )}
              </Box>
            </MotiView>
          </TouchableOpacity>
        );
      })}
    </Box>
  );
};

const styles = StyleSheet.create({
  itemContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 999,
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});
