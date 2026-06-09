import { useEffect, useRef } from 'react';
import { Button, Dialog, Portal, Text as PaperText } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccessibilityInfo, findNodeHandle, View } from 'react-native';
import { Box } from '../base';
import { Theme } from '../../core/theme';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  description?: string; // Now optional when using children
  children?: React.ReactNode; // For complex content
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
  dismissable?: boolean; // Controls backdrop dismiss
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  hideCancel?: boolean;
  loading?: boolean;
  disabled?: boolean; // Disables confirm button (e.g., phrase mismatch)
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
  loading = false,
  disabled = false,
}: ConfirmDialogProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('common');
  const confirmButtonRef = useRef<View>(null);

  // Focus the confirm button and announce title when dialog opens
  useEffect(() => {
    if (visible && confirmButtonRef.current) {
      const reactTag = findNodeHandle(confirmButtonRef.current);
      if (reactTag) {
        AccessibilityInfo.setAccessibilityFocus(reactTag);
      }
    }
  }, [visible]);

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={loading ? () => {} : onCancel}
        dismissable={dismissable && !loading}
        style={{
          backgroundColor: theme.colors.cardBackground,
          borderRadius: theme.borderRadii.m,
        }}
      >
        {/* Live region wrapper announces dialog content to screen readers */}
        <View accessibilityLiveRegion="polite" accessibilityViewIsModal={true}>
          {/* --- ICON --- */}
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
              textAlign: icon ? 'center' : 'left',
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
              <Button
                onPress={onCancel}
                textColor={theme.colors.textSecondary}
                disabled={loading}
              >
                {cancelLabel || t('dialog.cancel')}
              </Button>
            )}
            <Button
              ref={confirmButtonRef}
              onPress={onConfirm}
              textColor={isDangerous ? theme.colors.error : theme.colors.primary}
              loading={loading}
              disabled={loading || disabled}
            >
              {confirmLabel || t('dialog.confirm')}
            </Button>
          </Dialog.Actions>
        </View>
      </Dialog>
    </Portal>
  );
};