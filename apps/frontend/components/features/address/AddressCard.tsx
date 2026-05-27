import React from 'react';
import { Pressable, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { Address } from '@selene/types';

type AddressCardProps = {
  address: Address;
  onPress?: (address: Address) => void;
  onDelete?: (id: string) => void;
  isDeleting?: boolean;
  isProcessing?: boolean; // Centraliza cualquier cambio de estado (select/default)
};

export const AddressCard = ({
  address,
  onPress,
  onDelete,
  isDeleting = false,
  isProcessing = false,
}: AddressCardProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation(['address', 'common']);

  // La dirección activa es la predeterminada en la DB
  const isActive = address.is_default;

  const getLabelIcon = () => {
    switch (address.label?.toLowerCase()) {
      case 'home':
        return 'home-variant-outline';
      case 'work':
        return 'briefcase-outline';
      default:
        return 'map-marker-outline';
    }
  };

  return (
    <MotiView
      from={{ opacity: 0, translateY: 5 }}
      animate={{ opacity: isProcessing ? 0.6 : 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 200 }}
    >
      <Pressable
        onPress={() => onPress?.(address)}
        disabled={isProcessing || isDeleting}
      >
        {({ pressed }) => (
          <Box
            backgroundColor="cardBackground"
            borderRadius="l"
            overflow="hidden"
            marginVertical="s"
            flexDirection="row"
            borderWidth={1}
            borderColor="separator" // Borde minimalista siempre
            style={{
              elevation: pressed ? 2 : 4,
              shadowColor: '#000',
              shadowOpacity: 0.1,
              shadowRadius: 8,
              backgroundColor: pressed
                ? 'rgba(255,255,255,0.02)'
                : theme.colors.cardBackground,
            }}
          >
            {/* 1. BARRA DE ACENTO LATERAL (Indicador de Activa) */}
            <Box
              width={5}
              backgroundColor={isActive ? 'primary' : 'separator'}
              opacity={isActive ? 1 : 0.1}
            />

            <Box flex={1} padding="m">
              {/* HEADER */}
              <Box
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
                marginBottom="s"
              >
                <Box flex={1}>
                  <Box
                    flexDirection="row"
                    alignItems="center"
                    marginBottom="xs"
                  >
                    <MaterialCommunityIcons
                      name={getLabelIcon()}
                      size={16}
                      color={theme.colors.primary}
                    />
                    <Text
                      variant="caption-md"
                      color="primary"
                      fontWeight="bold"
                      marginLeft="xs"
                      style={{ letterSpacing: 1 }}
                    >
                      {address.label?.toUpperCase()}
                    </Text>
                  </Box>
                  <Text
                    variant="subheader-md"
                    fontWeight="bold"
                    color={isActive ? 'primary' : 'textPrimary'}
                  >
                    {address.full_name}
                  </Text>
                </Box>

                {/* SPINNER DE PROCESAMIENTO (Selección/Default) */}
                {isProcessing && (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.primary}
                  />
                )}

                {isActive && !isProcessing && (
                  <Box
                    backgroundColor="primary"
                    paddingHorizontal="s"
                    paddingVertical="xs"
                    borderRadius="s"
                    style={{
                      backgroundColor: 'rgba(189, 159, 101, 0.15)',
                      borderWidth: 1,
                      borderColor: theme.colors.primary,
                    }}
                  >
                    <Text
                      variant="caption-md"
                      color="primary"
                      fontWeight="bold"
                    >
                      {t('address:labels.default').toUpperCase()}
                    </Text>
                  </Box>
                )}
              </Box>

              {/* CUERPO */}
              <Box marginBottom="m">
                <Text variant="body-md" color="textPrimary" marginBottom="xs">
                  {address.street_line1}{' '}
                  {address.street_line2 ? `- ${address.street_line2}` : ''}
                </Text>
                <Text variant="caption-md" color="textSecondary">
                  Col. {address.district}, {address.city}
                </Text>
                <Text variant="caption-md" color="textSecondary">
                  {address.state} {address.zip_code}
                </Text>
              </Box>

              {/* FOOTER */}
              <Box
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
                paddingTop="s"
                borderTopWidth={1}
                borderTopColor="separator"
              >
                <Box flexDirection="row" alignItems="center">
                  <MaterialCommunityIcons
                    name="phone-outline"
                    size={14}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    variant="caption-md"
                    color="textSecondary"
                    marginLeft="xs"
                  >
                    {address.phone}
                  </Text>
                </Box>

                {/* ACCIÓN: ELIMINAR (Solo si no es la activa) */}
                {onDelete && !isActive && (
                  <TouchableOpacity
                    onPress={() => onDelete(address.id)}
                    disabled={isDeleting || isProcessing}
                    hitSlop={10}
                  >
                    {isDeleting ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.error}
                      />
                    ) : (
                      <MaterialCommunityIcons
                        name="trash-can-outline"
                        size={20}
                        color={theme.colors.error}
                      />
                    )}
                  </TouchableOpacity>
                )}
              </Box>
            </Box>
          </Box>
        )}
      </Pressable>
    </MotiView>
  );
};
