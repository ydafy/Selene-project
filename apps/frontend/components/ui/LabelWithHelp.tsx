import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../base';
import { Theme } from '../../core/theme';
import { ConfirmDialog } from './ConfirmDialog';

type LabelWithHelpProps = {
  label: string;
  helpTitle: string;
  helpDescription: string;
  color?: 'textPrimary' | 'textSecondary' | 'primary';
};

export const LabelWithHelp = ({
  label,
  helpTitle,
  helpDescription,
  color = 'textSecondary',
}: LabelWithHelpProps) => {
  const theme = useTheme<Theme>();
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Box flexDirection="row" alignItems="center" marginBottom="s">
        <Text variant="body-md" color={color} marginRight="xs">
          {label}
        </Text>

        <TouchableOpacity
          onPress={() => setVisible(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialCommunityIcons
            name="help-circle-outline"
            size={18}
            color={theme.colors.primary} // Color dorado para resaltar que es interactivo
          />
        </TouchableOpacity>
      </Box>

      {/* Reutilizamos tu ConfirmDialog como Modal de Información */}
      <ConfirmDialog
        visible={visible}
        title={helpTitle}
        description={helpDescription}
        onConfirm={() => setVisible(false)}
        onCancel={() => setVisible(false)}
        confirmLabel="Entendido"
        hideCancel={true} // ¡Truco! Solo mostramos "Entendido"
        icon="lightbulb-on-outline" // Icono de "Idea"
      />
    </>
  );
};
