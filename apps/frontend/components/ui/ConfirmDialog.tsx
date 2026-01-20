import { Button, Dialog, Portal, Text as PaperText } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box } from '../base';
import { Theme } from '../../core/theme';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  description?: string; // Ahora es opcional si usas children
  children?: React.ReactNode; // Para contenido complejo
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
  dismissable?: boolean; // Controla si se puede cerrar tocando fuera
  icon?: keyof typeof MaterialCommunityIcons.glyphMap; // Nombre del icono
  hideCancel?: boolean;
};

export const ConfirmDialog = ({
  visible,
  title,
  description,
  children,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
  isDangerous = false,
  dismissable = true,
  icon,
  hideCancel = false,
}: ConfirmDialogProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('common');

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={onCancel}
        dismissable={dismissable}
        style={{
          backgroundColor: theme.colors.cardBackground,
          borderRadius: theme.borderRadii.m,
        }}
      >
        {/* --- ICONO CENTRAL (Si existe) --- */}
        {icon && (
          <Box alignItems="center" marginTop="m">
            <MaterialCommunityIcons
              name={icon}
              size={40}
              color={isDangerous ? theme.colors.error : theme.colors.primary}
            />
          </Box>
        )}

        <Dialog.Title
          style={{
            color: theme.colors.textPrimary,
            fontFamily: 'Montserrat-Bold',
            textAlign: icon ? 'center' : 'left', // Centramos si hay icono
          }}
        >
          {title}
        </Dialog.Title>

        <Dialog.Content>
          {description && (
            <PaperText
              variant="bodyMedium"
              style={{
                color: theme.colors.textPrimary,
                fontFamily: 'Montserrat-Regular',
                textAlign: icon ? 'center' : 'left',
              }}
            >
              {description}
            </PaperText>
          )}
          {children}
        </Dialog.Content>

        <Dialog.Actions>
          {!hideCancel && (
            <Button onPress={onCancel} textColor={theme.colors.textSecondary}>
              {cancelLabel || t('dialog.cancel')}
            </Button>
          )}
          <Button
            onPress={onConfirm}
            textColor={isDangerous ? theme.colors.error : theme.colors.primary}
          >
            {confirmLabel || t('dialog.confirm')}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};
