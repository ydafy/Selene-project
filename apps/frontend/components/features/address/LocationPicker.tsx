import React from 'react';
import { TouchableOpacity, Dimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MAP_HEIGHT = 250; // Altura estilo Uber

type LocationPickerProps = {
  // En el futuro recibirá coordenadas y handlers
  value?: string;
};

export const LocationPicker = ({ value }: LocationPickerProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box
      width={SCREEN_WIDTH}
      height={MAP_HEIGHT}
      backgroundColor="cardBackground"
      position="relative"
      overflow="hidden"
    >
      {/* SIMULACIÓN DE MAPA (Placeholder) */}
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        style={{ backgroundColor: '#2a2a2a' }} // Un gris mapa oscuro
      >
        <MaterialCommunityIcons
          name="map-marker"
          size={40}
          color={theme.colors.primary}
        />
        <Text variant="caption-md" color="textSecondary" marginTop="s">
          Mapa de Google (Próximamente)
        </Text>
      </Box>

      {/* INPUT FLOTANTE (Simula la barra de búsqueda de Uber) */}
      <Box
        position="absolute"
        top={60} // Debajo del header transparente
        left={16}
        right={16}
      >
        <TouchableOpacity activeOpacity={0.9}>
          <Box
            flexDirection="row"
            alignItems="center"
            backgroundColor="cardBackground"
            padding="m"
            borderRadius="m"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 5,
              elevation: 5,
            }}
          >
            <MaterialCommunityIcons
              name="magnify"
              size={20}
              color={theme.colors.primary}
            />
            <Text
              variant="body-md"
              marginLeft="s"
              color="textPrimary"
              numberOfLines={1}
            >
              {value || 'Buscar calle y número...'}
            </Text>
          </Box>
        </TouchableOpacity>
      </Box>
    </Box>
  );
};
