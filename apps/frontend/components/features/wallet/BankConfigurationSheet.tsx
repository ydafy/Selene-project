import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  forwardRef,
} from 'react';
import { StyleSheet, Keyboard, TouchableWithoutFeedback } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TextInput as PaperTextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { FormTextInput } from '../../ui/FormTextInput';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { validateClabe } from '../../../core/utils/clabeValidator';
import { useWalletStore } from '../../../core/store/useWalletStore';
import { useAuthContext } from '../../auth/AuthProvider';

export type BankSheetRef = BottomSheetModal;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const BankConfigurationSheet = forwardRef<BottomSheetModal, {}>(
  ({}, ref) => {
    const theme = useTheme<Theme>();
    const { t } = useTranslation('wallet');
    const { session } = useAuthContext();
    const { bankAccount, saveBankAccount, isActionLoading } = useWalletStore();

    const [clabe, setClabe] = useState('');
    const [holderName, setHolderName] = useState('');
    const [bankName, setBankName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showSuccess, setShowSuccess] = useState(false);

    const snapPoints = useMemo(() => ['80%'], []);

    useEffect(() => {
      if (bankAccount) {
        setClabe(bankAccount.clabe);
        setHolderName(bankAccount.account_holder_name);
        setBankName(bankAccount.bank_name || null);
      }
    }, [bankAccount]);

    const resetForm = useCallback(() => {
      if (!bankAccount) {
        setClabe('');
        setHolderName('');
        setBankName(null);
        setError(null);
      }
    }, [bankAccount]);

    const handleClabeChange = (text: string) => {
      const cleanText = text.replace(/[^0-9]/g, '');
      setClabe(cleanText);

      if (cleanText.length === 18) {
        const validation = validateClabe(cleanText);
        if (validation.isValid) {
          setBankName(validation.bankName);
          setError(null);
        } else {
          setBankName(null);
          setError(
            validation.error || t('bankConfiguration.errors.invalidClabe'),
          );
        }
      } else if (cleanText.length > 0 && cleanText.length < 18) {
        setBankName(null);
        setError(t('bankConfiguration.errors.clabeLength'));
      } else {
        setBankName(null);
        setError(null);
      }
    };

    const handleSave = async () => {
      if (!session?.user.id) return;
      Keyboard.dismiss();

      if (holderName.length < 3) {
        setError(t('bankConfiguration.errors.holderNameLength'));
        return;
      }

      const validation = validateClabe(clabe);
      if (!validation.isValid) {
        setError(
          validation.error || t('bankConfiguration.errors.invalidClabe'),
        );
        return;
      }

      const result = await saveBankAccount(
        session.user.id,
        clabe,
        holderName,
        validation.bankName || 'OTRO',
      );

      if (result.success) {
        setShowSuccess(true);
      }
    };

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.7}
          onPress={() => {
            Keyboard.dismiss();
            if (ref && typeof ref === 'object' && ref.current) {
              (ref as React.RefObject<BottomSheetModal>).current?.dismiss();
            }
          }}
        />
      ),
      [ref],
    );

    return (
      <BottomSheetModal
        ref={ref}
        index={1}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        onDismiss={resetForm}
        backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetView style={styles.contentContainer}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <Box paddingHorizontal="l" paddingBottom="xl" flex={1}>
              <Box
                alignItems="center"
                marginBottom="l"
                borderBottomWidth={1}
                borderBottomColor="separator"
                paddingBottom="m"
              >
                <MaterialCommunityIcons
                  name="bank-outline"
                  size={40}
                  color={theme.colors.primary}
                />
                <Text variant="subheader-md" marginTop="s">
                  {t('bankConfiguration.title')}
                </Text>
                <Text
                  variant="caption-md"
                  color="textSecondary"
                  textAlign="center"
                  marginTop="xs"
                >
                  {t('bankConfiguration.description')}
                </Text>
              </Box>

              <Box marginBottom="m">
                <FormTextInput
                  label={t('bankConfiguration.inputs.holderName.label')}
                  placeholder={t(
                    'bankConfiguration.inputs.holderName.placeholder',
                  )}
                  value={holderName}
                  onChangeText={setHolderName}
                  autoCapitalize="words"
                  leftIcon="account"
                />
              </Box>

              <Box marginBottom="l">
                <FormTextInput
                  label={t('bankConfiguration.inputs.clabe.label')}
                  placeholder={t('bankConfiguration.inputs.clabe.placeholder')}
                  value={clabe}
                  onChangeText={handleClabeChange}
                  keyboardType="number-pad"
                  maxLength={18}
                  leftIcon="numeric"
                  right={
                    bankName ? (
                      <PaperTextInput.Icon
                        icon="check-circle"
                        color={theme.colors.success}
                      />
                    ) : undefined
                  }
                />

                {bankName && (
                  <Box flexDirection="row" alignItems="center" marginTop="s">
                    <MaterialCommunityIcons
                      name="bank"
                      size={16}
                      color={theme.colors.success}
                    />
                    <Text
                      variant="caption-md"
                      color="success"
                      marginLeft="s"
                      fontWeight="bold"
                    >
                      {bankName}
                    </Text>
                  </Box>
                )}

                {error && (
                  <Text variant="caption-md" color="error" marginTop="s">
                    {error}
                  </Text>
                )}
              </Box>

              <Box flex={1} justifyContent="flex-end">
                <PrimaryButton
                  onPress={handleSave}
                  loading={isActionLoading}
                  disabled={
                    !bankName || holderName.length < 3 || isActionLoading
                  }
                  icon="content-save"
                >
                  {t('bankConfiguration.saveButton')}
                </PrimaryButton>
              </Box>

              <ConfirmDialog
                visible={showSuccess}
                title={t('bankConfiguration.success.title')}
                description={t('bankConfiguration.success.description')}
                onConfirm={() => {
                  setShowSuccess(false);
                  if (ref && typeof ref === 'object' && ref.current) {
                    (
                      ref as React.RefObject<BottomSheetModal>
                    ).current?.dismiss();
                  }
                }}
                onCancel={() => setShowSuccess(false)}
                confirmLabel={t('bankConfiguration.success.confirmButton')}
                hideCancel
                icon="check-circle-outline"
              />
            </Box>
          </TouchableWithoutFeedback>
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create({
  contentContainer: { flex: 1 },
});
