import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { Address } from '@selene/types';

type AddressCardProps = {
  address: Address;
  onPress?: (address: Address) => void; // Para seleccionar en el checkout
  onDelete?: (id: string) => void;
  onSetDefault?: (id: string) => void;
  selectable?: boolean; // Si estamos en modo selección o solo gestión
  isSelected?: boolean;
};

export const AddressCard = ({
  address,
  onPress,
  onDelete,
  onSetDefault,
  selectable = false,
  isSelected = false,
}: AddressCardProps) => {
  const theme = useTheme<Theme>();

  return (
    <TouchableOpacity
      onPress={() => onPress && onPress(address)}
      activeOpacity={0.8}
      disabled={!onPress}
    >
      <Box
        backgroundColor="cardBackground"
        borderRadius="m"
        padding="m"
        marginBottom="m"
        borderWidth={1}
        borderColor={isSelected ? 'primary' : 'cardBackground'}
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 2,
        }}
      >
        {/* Header: Nombre y Badges */}
        <Box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          marginBottom="s"
        >
          <Box flexDirection="row" alignItems="center">
            <MaterialCommunityIcons
              name={address.is_default ? 'star' : 'map-marker-outline'}
              size={20}
              color={
                address.is_default
                  ? theme.colors.primary
                  : theme.colors.textSecondary
              }
            />
            <Text variant="subheader-md" marginLeft="s">
              {address.full_name}
            </Text>
          </Box>

          {address.is_default && (
            <Box
              backgroundColor="primary"
              paddingHorizontal="s"
              paddingVertical="xs"
              borderRadius="s"
            >
              <Text variant="body-md" color="background" fontWeight="bold">
                Default
              </Text>
            </Box>
          )}
        </Box>

        {/* Dirección */}
        <Text variant="body-md" color="textSecondary">
          {address.street_line1}{' '}
          {address.street_line2 ? `, ${address.street_line2}` : ''}
        </Text>
        <Text variant="body-md" color="textSecondary">
          {address.city}, {address.state} {address.zip_code}
        </Text>
        <Text variant="body-md" color="textSecondary" marginTop="xs">
          📞 {address.phone}
        </Text>

        {/* Acciones (Solo si no estamos seleccionando para compra rápida) */}
        {!selectable && (
          <Box
            flexDirection="row"
            justifyContent="flex-end"
            marginTop="m"
            borderTopWidth={1}
            borderTopColor="background"
            paddingTop="s"
          >
            {!address.is_default && onSetDefault && (
              <TouchableOpacity
                onPress={() => onSetDefault(address.id)}
                style={{ marginRight: 16 }}
              >
                <Text variant="caption-md" color="textSecondary">
                  Hacer Default
                </Text>
              </TouchableOpacity>
            )}

            {onDelete && (
              <TouchableOpacity onPress={() => onDelete(address.id)}>
                <Text variant="caption-md" color="error">
                  Eliminar
                </Text>
              </TouchableOpacity>
            )}
          </Box>
        )}
      </Box>
    </TouchableOpacity>
  );
};
