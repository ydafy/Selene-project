import { TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { MotiView } from 'moti'; // <-- Usamos Moti
import { Box, Text } from '../base';
import { Theme } from '../../core/theme';

type SegmentedControlProps = {
  options: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
};

export const SegmentedControl = ({
  options,
  selectedIndex,
  onChange,
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

        return (
          <TouchableOpacity
            key={option}
            onPress={() => onChange(index)} // Ya no necesitamos LayoutAnimation aquí
            style={{ flex: 1 }}
            activeOpacity={0.8}
          >
            {/* Usamos MotiView para el fondo animado */}
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
              style={[
                styles.itemContainer,
                isSelected && styles.shadow, // Solo aplicamos sombra si está seleccionado
              ]}
            >
              <Text
                variant="body-sm"
                fontWeight="bold"
                style={{
                  // Cambiamos el color del texto instantáneamente (o podrías animarlo también)
                  color: isSelected
                    ? theme.colors.primary
                    : theme.colors.textSecondary,
                }}
              >
                {option}
              </Text>
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
    borderRadius: 999, // Usamos un número alto para asegurar 'full' en Moti
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});
