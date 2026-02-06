import React from 'react';
import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { useAddresses } from '../../../core/hooks/useAddresses';

type LocationHeaderButtonProps = {
  onPress: () => void;
};

export const LocationHeaderButton = ({
  onPress,
}: LocationHeaderButtonProps) => {
  const theme = useTheme<Theme>();
  const { addresses } = useAddresses();

  const activeAddress = addresses?.find((a) => a.is_default) || addresses?.[0];
  const displayText = activeAddress
    ? activeAddress.street_line1
    : 'Mi dirección';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      {/* CAMBIO: Quitamos el 'column' y el texto 'Entregar en' */}
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="flex-start"
        paddingVertical="xs"
        marginLeft="s"
      >
        <Text
          variant="body-md"
          color="textPrimary"
          numberOfLines={1}
          style={{ maxWidth: 200 }}
        >
          {displayText}
        </Text>
        <MaterialCommunityIcons
          name="chevron-down"
          size={20}
          color={theme.colors.primary}
          style={{ marginLeft: 4 }} // Un poco más separado
        />
      </Box>
    </TouchableOpacity>
  );
};
