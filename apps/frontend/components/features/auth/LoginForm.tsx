/**
 * @file components/features/auth/LoginForm.tsx
 * @description Formulario de inicio de sesión optimizado.
 * Centraliza la lógica de Google y Email en hooks especializados.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../base';
import { FormTextInput } from '../../ui/FormTextInput';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { GoogleButton } from '../../ui/GoogleButton';
import { TextLink } from '../../ui/TextLink';
import { useAuth, loginSchema, LoginData } from '../../../core/hooks/useAuth';
import { useGoogleAuth } from '../../../core/hooks/useGoogleAuth'; // <--- NUEVO
import { Theme } from '../../../core/theme';

type LoginFormProps = {
  onSuccess: () => void;
  onRegisterPress: () => void;
  onForgotPasswordPress?: () => void;
};

export const LoginForm = ({
  onSuccess,
  onRegisterPress,
  onForgotPasswordPress,
}: LoginFormProps) => {
  const { t } = useTranslation('auth');
  const theme = useTheme<Theme>();
  const { signIn, loading, resendSignUpOtp } = useAuth();

  // 1. MOTOR DE GOOGLE (Centralizado)
  const { signInWithGoogle, isGoogleLoading } = useGoogleAuth(onSuccess);

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    mode: 'onChange',
  });

  const onSubmit = async (data: LoginData) => {
    try {
      const result = await signIn(data);

      if (!result.success) {
        if (result.error?.message === 'Email not confirmed') {
          Toast.show({
            type: 'info',
            text1: t('verificationRequired'),
            text2: t('resendingCode'),
          });
          await resendSignUpOtp(data.email);
          return;
        }

        Toast.show({
          type: 'error',
          text1: t('loginErrorTitle'),
          text2: result.error?.message || t('common:errors.generic'),
        });
        return;
      }

      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Toast.show({
        type: 'error',
        text1: t('loginErrorTitle'),
        text2: message,
      });
    }
  };

  const isBusy = loading || isGoogleLoading;

  return (
    <Box width="100%">
      <Box height={24} />

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextInput
            label={t('emailLabel')}
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon="account-outline"
            error={!!errors.email}
          />
        )}
      />
      {errors.email && (
        <Text variant="body-sm" color="error" marginTop="s" marginLeft="s">
          {t(errors.email.message as string)}
        </Text>
      )}

      <Box height={26} />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextInput
            label={t('passwordLabel')}
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
            secureTextEntry
            leftIcon="lock-outline"
            error={!!errors.password}
          />
        )}
      />
      {errors.password && (
        <Text variant="body-sm" color="error" marginTop="s" marginLeft="s">
          {t(errors.password.message as string)}
        </Text>
      )}

      <Box height={26} />

      <PrimaryButton
        onPress={handleSubmit(onSubmit)}
        loading={loading}
        disabled={!isValid || isBusy}
      >
        {t('loginButton')}
      </PrimaryButton>

      <Box flexDirection="row" alignItems="center" marginVertical="l">
        <Box flex={1} height={1} backgroundColor="cardBackground" />
        <Text variant="body-sm" marginHorizontal="m">
          {t('or')}
        </Text>
        <Box flex={1} height={1} backgroundColor="cardBackground" />
      </Box>

      <GoogleButton
        onPress={signInWithGoogle}
        label={
          isGoogleLoading ? t('common:states.loading') : t('continueWithGoogle')
        }
        disabled={isBusy}
      />

      {onForgotPasswordPress && (
        <TextLink
          onPress={onForgotPasswordPress}
          style={{ alignSelf: 'center', marginTop: 24 }}
        >
          {t('forgotPassword')}
        </TextLink>
      )}

      <Box
        paddingVertical="l"
        alignItems="center"
        flexDirection="row"
        justifyContent="center"
      >
        <Text variant="body-md" color="textSecondary">
          {t('noAccount')}{' '}
        </Text>
        <TextLink onPress={onRegisterPress}>{t('signUpLink')}</TextLink>
      </Box>
    </Box>
  );
};
