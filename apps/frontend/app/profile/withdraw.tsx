import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@shopify/restyle';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../../components/base';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { ErrorState } from '../../components/ui/ErrorState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useWalletStore } from '../../core/store/useWalletStore';
import { formatCurrency } from '../../core/utils/format';
import { authenticateAsync } from '../../core/utils/biometrics';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Theme } from '../../core/theme';

export default function WithdrawScreen() {
  const { t } = useTranslation(['withdraw', 'common']);
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const isMounted = useRef(true); // Para seguridad de memoria

  const { wallet, bankAccount, requestPayout, isActionLoading } =
    useWalletStore();

  const [amount, setAmount] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [errorDialog, setErrorDialog] = useState({
    visible: false,
    message: '',
  });

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // --- LÓGICA DE CÁLCULO OPTIMIZADA (IA Local Fix) ---
  const availableBalance = wallet?.available_balance || 0;
  const numericAmount = useMemo(() => parseFloat(amount) || 0, [amount]);
  const isOverLimit = numericAmount > availableBalance;
  const isValid = numericAmount > 0 && !isOverLimit;

  const amountColor = useMemo(() => {
    if (numericAmount === 0) return theme.colors.textSecondary;
    return isOverLimit ? theme.colors.error : theme.colors.primary;
  }, [numericAmount, isOverLimit, theme]);

  if (!bankAccount) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader title={t('title')} showBack />
        <ErrorState
          title={t('errors.noBankAccount')}
          message={t('errors.configureFirst')}
          onRetry={() => router.back()}
        />
      </Box>
    );
  }

  const handleMax = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAmount(availableBalance.toString());
  };

  const onConfirm = async () => {
    if (!isValid) return;

    // 1. Autenticación
    const auth = await authenticateAsync(t('security.reason'));
    if (!auth.success) return;

    // 2. Procesar
    const result = await requestPayout(numericAmount, bankAccount.id);

    // 3. Verificar si el componente sigue vivo antes de actualizar estado
    if (!isMounted.current) return;

    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowSuccess(true);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorDialog({
        visible: true,
        message: result.error || t('common:errors.generic'), // i18n Fix
      });
    }
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader title={t('title')} showBack />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} // Android Fix
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingTop: insets.top + 80, // Dynamic Padding Fix
            paddingBottom: 40,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
          {/* 1. FLUJO VISUAL */}
          <MotiView
            from={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <Box
              backgroundColor="cardBackground"
              borderRadius="l"
              padding="m"
              borderWidth={1}
              borderColor="separator"
              marginBottom="l"
            >
              <Box flexDirection="row" alignItems="center">
                <Box
                  width={32}
                  height={32}
                  borderRadius="full"
                  backgroundColor="background"
                  justifyContent="center"
                  alignItems="center"
                >
                  <MaterialCommunityIcons
                    name="wallet"
                    size={18}
                    color={theme.colors.primary}
                  />
                </Box>
                <Text variant="body-md" marginLeft="s" color="textSecondary">
                  {t('source.label')}
                </Text>
              </Box>
              <Box
                height={15}
                width={1}
                backgroundColor="separator"
                marginLeft={'m'}
                marginVertical="xs"
                opacity={0.3}
              />
              <Box flexDirection="row" alignItems="center">
                <Box
                  width={32}
                  height={32}
                  borderRadius="full"
                  backgroundColor="primary"
                  justifyContent="center"
                  alignItems="center"
                >
                  <MaterialCommunityIcons name="bank" size={18} color="black" />
                </Box>
                <Box marginLeft="s">
                  <Text variant="body-md">{bankAccount.bank_name}</Text>
                  <Text variant="caption-md" color="textSecondary">
                    •••• {bankAccount.clabe.slice(-4)}
                  </Text>
                </Box>
              </Box>
            </Box>
          </MotiView>

          {/* 2. PANEL DE MONTO (CONTROL CENTER) */}
          <MotiView
            from={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 200 }}
          >
            <Box
              backgroundColor="cardBackground"
              borderRadius="xl"
              paddingVertical="xl"
              paddingHorizontal="l"
              borderWidth={1}
              borderColor={isOverLimit ? 'error' : 'separator'}
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.2,
                shadowRadius: 16,
                elevation: 10,
              }}
            >
              <Box
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
                marginBottom="l"
              >
                <Text variant="body-md" color="primary">
                  {t('amountToWithdraw').toUpperCase()}
                </Text>
                {/* Botón MAX Integrado y Elegante */}
                <TouchableOpacity
                  onPress={handleMax}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Box
                    backgroundColor={isOverLimit ? 'error' : 'primary'}
                    paddingHorizontal="m"
                    paddingVertical="xs"
                    borderRadius="full"
                  >
                    <Text
                      variant="caption-md"
                      color={isOverLimit ? 'error' : 'cardBackground'}
                    >
                      {t('maxBtn')}
                    </Text>
                  </Box>
                </TouchableOpacity>
              </Box>

              {/* Input Central Masivo */}
              <Box
                flexDirection="row"
                alignItems="center"
                justifyContent="center"
                marginBottom="l"
              >
                <Text
                  style={{
                    fontSize: 26,
                    color: amountColor,

                    marginRight: 4,
                  }}
                >
                  $
                </Text>
                <Box width={240}>
                  <FormTextInput
                    placeholder="0.00"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    style={{
                      fontSize: 40, // Aún más grande
                      textAlign: 'center',
                      color: amountColor,
                      fontFamily: 'Montserrat-Bold',
                      backgroundColor: 'transparent',
                      padding: 0,
                      margin: 0,
                    }}
                    labelMode="static"
                    cursorColor={theme.colors.primary}
                  />
                </Box>
              </Box>

              {/* Barra de Progreso Visual */}
              <Box
                height={4}
                backgroundColor="background"
                borderRadius="full"
                width="100%"
                overflow="hidden"
                marginBottom="s"
              >
                <Box
                  height="100%"
                  width={`${Math.min((numericAmount / availableBalance) * 100, 100)}%`}
                  backgroundColor={isOverLimit ? 'error' : 'primary'}
                  borderRadius="full"
                />
              </Box>

              <Box flexDirection="row" justifyContent="flex-end">
                <Text variant="caption-md" color="textSecondary">
                  {t('available')}:{' '}
                  <Text color="textPrimary" fontWeight="bold">
                    {formatCurrency(availableBalance)}
                  </Text>
                </Text>
              </Box>
            </Box>
          </MotiView>

          {/* 3. RESUMEN */}
          <Box marginTop="l" paddingHorizontal="s" gap="xs">
            <Box flexDirection="row" justifyContent="space-between">
              <Text variant="caption-lg" color="textSecondary">
                {t('fees.withdrawal')}
              </Text>
              <Text variant="caption-lg" color="success" fontWeight="bold">
                {t('fees.free')}
              </Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between">
              <Text variant="caption-lg" color="textSecondary">
                {t('timing.label')}
              </Text>
              <Text variant="caption-lg" color="textPrimary">
                {t('timing.value')}
              </Text>
            </Box>
          </Box>

          {/* 4. ACCIÓN FINAL */}
          <Box marginTop="xl">
            <PrimaryButton
              onPress={onConfirm}
              loading={isActionLoading}
              disabled={!isValid || isActionLoading}
              icon={isOverLimit ? 'alert-circle' : 'shield-check'}
            >
              {isOverLimit ? t('insufficientButton') : t('confirmBtn')}
            </PrimaryButton>
          </Box>

          <Box
            marginTop="m"
            opacity={0.5}
            flexDirection="row"
            justifyContent="center"
            alignItems="center"
          >
            <MaterialCommunityIcons
              name="shield-lock-outline"
              size={14}
              color={theme.colors.textSecondary}
            />
            <Text variant="caption-md" color="textSecondary" marginLeft="xs">
              {t('securityFooter')}
            </Text>
          </Box>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* MODALES */}
      <ConfirmDialog
        visible={showSuccess}
        title={t('success.title')}
        description={t('success.message')}
        onConfirm={() => {
          setShowSuccess(false);
          router.back();
        }}
        onCancel={() => {}}
        confirmLabel={t('dialog.confirm')}
        hideCancel
        icon="check-circle-outline"
      />

      <ConfirmDialog
        visible={errorDialog.visible}
        title={t('dialog.errorTitle')}
        description={errorDialog.message}
        onConfirm={() => setErrorDialog({ ...errorDialog, visible: false })}
        onCancel={() => setErrorDialog({ ...errorDialog, visible: false })}
        confirmLabel={t('dialog.ok')}
        hideCancel
        icon="alert-circle-outline"
        isDangerous
      />
    </Box>
  );
}
