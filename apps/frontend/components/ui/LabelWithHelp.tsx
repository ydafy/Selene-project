import React, { useEffect, useRef, useState } from 'react';
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
  /** Optional translated label for the modal confirm button. Defaults to the legacy hardcoded label. */
  confirmLabel?: string;
  disabled?: boolean;
  canInteract?: () => boolean;
};

export const LabelWithHelp = ({
  label,
  helpTitle,
  helpDescription,
  color = 'textSecondary',
  confirmLabel,
  disabled = false,
  canInteract,
}: LabelWithHelpProps) => {
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const canInteractRef = useRef(canInteract);
  canInteractRef.current = canInteract;
  const theme = useTheme<Theme>();
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (disabled) setVisible(false); }, [disabled]);

  return (
    <>
      <Box flexDirection="row" alignItems="center" marginBottom="s">
        <Text variant="body-md" color={color} marginRight="xs">
          {label}
        </Text>

        <TouchableOpacity
          disabled={disabled}
          accessibilityState={{ disabled }}
          onPress={() => { if (!disabledRef.current && canInteractRef.current?.() !== false) setVisible(true); }}
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
        visible={visible && !disabled}
        title={helpTitle}
        description={helpDescription}
        onConfirm={() => { if (!disabledRef.current && canInteractRef.current?.() !== false) setVisible(false); }}
        onCancel={() => { if (!disabledRef.current && canInteractRef.current?.() !== false) setVisible(false); }}
        confirmLabel={confirmLabel ?? 'Entendido'}
        hideCancel={true} // ¡Truco! Solo mostramos "Entendido"
        icon="lightbulb-on-outline" // Icono de "Idea"
      />
    </>
  );
};
