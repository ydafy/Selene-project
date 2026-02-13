import React from 'react';
import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Product } from '@selene/types';

interface Props {
  items: Product[];
  onPress: () => void;
}

export const OrderPreviewStrip = ({ items, onPress }: Props) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{ width: '100%' }}
    >
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="background"
        padding="s"
        borderRadius="m"
        borderWidth={1}
        borderColor="separator"
        justifyContent="space-between"
      >
        <Box flexDirection="row" alignItems="center" marginLeft="s">
          <MaterialCommunityIcons
            name="format-list-bulleted"
            size={18}
            color="#666"
          />
          <Text variant="caption-md" color="textSecondary" marginLeft="s">
            {items.length} {items.length === 1 ? 'producto' : 'productos'}
          </Text>
        </Box>

        <Box flexDirection="row" alignItems="center">
          {/* Stack de miniaturas (máximo 3) */}
          <Box flexDirection="row" marginRight="s">
            {items.slice(0, 3).map((item, index) => (
              <Box
                key={item.id}
                width={24}
                height={24}
                borderRadius="s"
                overflow="hidden"
                borderWidth={2}
                borderColor="cardBackground"
                style={{ marginLeft: index === 0 ? 0 : -10 }}
              >
                <AppImage
                  source={{ uri: item.images?.[0] }}
                  style={{ width: '100%', height: '100%' }}
                />
              </Box>
            ))}
          </Box>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#666" />
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
