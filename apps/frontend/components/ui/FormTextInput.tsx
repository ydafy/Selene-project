import { useState, forwardRef } from 'react';
import { TouchableOpacity } from 'react-native';
import {
  TextInput as PaperTextInput,
  TextInputProps,
} from 'react-native-paper';
import type { TextInput as RNTextInput } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../base';
import { Theme } from '../../core/theme';
import { ConfirmDialog } from './ConfirmDialog';

type FormTextInputProps = Omit<TextInputProps, 'theme'> & {
  leftIcon?: string;
  label?: string;
  helpTitle?: string;
  helpDescription?: string;
  // NUEVA PROP: Controla dónde se renderiza el label
  labelMode?: 'floating' | 'static';
};

export const FormTextInput = forwardRef<RNTextInput, FormTextInputProps>(
  (
    {
      leftIcon,
      secureTextEntry,
      label,
      helpTitle,
      helpDescription,
      labelMode = 'floating', // <--- Default: Floating (Para no romper Auth)
      style,
      ...rest
    },
    ref,
  ) => {
    const theme = useTheme<Theme>();
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isHelpVisible, setIsHelpVisible] = useState(false);

    const isPasswordField = !!secureTextEntry;
    const hasHelp = !!helpTitle && !!helpDescription;

    // Lógica: Si es 'static', mostramos el texto afuera.
    // Si es 'floating', Paper se encarga (y ocultamos el de afuera).
    const showExternalLabel = labelMode === 'static' && !!label;

    return (
      <Box width="100%">
        {/* 1. LABEL EXTERNO (Solo en modo static) */}
        {showExternalLabel && (
          <Box flexDirection="row" alignItems="center" marginBottom="xs">
            <Text variant="body-md" color="textSecondary" marginRight="xs">
              {label}
            </Text>

            {hasHelp && (
              <TouchableOpacity
                onPress={() => setIsHelpVisible(true)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons
                  name="help-circle-outline"
                  size={18}
                  color={theme.colors.primary}
                />
              </TouchableOpacity>
            )}
          </Box>
        )}

        {/* 2. EL INPUT */}
        <PaperTextInput
          ref={ref}
          {...rest}
          // Si es modo floating, pasamos el label a Paper. Si es static, undefined.
          label={labelMode === 'floating' ? label : undefined}
          mode="flat"
          style={[{ backgroundColor: 'transparent' }, style]}
          left={leftIcon ? <PaperTextInput.Icon icon={leftIcon} /> : undefined}
          secureTextEntry={isPasswordField ? !isPasswordVisible : false}
          right={
            isPasswordField ? (
              <PaperTextInput.Icon
                icon={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                onPress={() => setIsPasswordVisible((prev) => !prev)}
              />
            ) : (
              rest.right
            )
          }
        />

        {/* 3. MODAL DE AYUDA */}
        {hasHelp && (
          <ConfirmDialog
            visible={isHelpVisible}
            title={helpTitle || ''}
            description={helpDescription}
            onConfirm={() => setIsHelpVisible(false)}
            onCancel={() => setIsHelpVisible(false)}
            confirmLabel="Entendido"
            hideCancel={true}
            icon="lightbulb-on-outline"
          />
        )}
      </Box>
    );
  },
);
