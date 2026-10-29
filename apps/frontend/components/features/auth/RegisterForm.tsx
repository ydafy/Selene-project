/**
 * @file components/features/auth/RegisterForm.tsx
 * @description Formulario de registro refinado.
 * Utiliza hooks centralizados para Auth y Google Sign-In para garantizar consistencia.
 */

import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { TextInput as RNTextInput } from 'react-native'; // <--- IMPORTANTE
import Toast from 'react-native-toast-message';
import { router } from 'expo-router';

import { Box, Text } from '../../base';
import { FormTextInput } from '../../ui/FormTextInput';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { GoogleButton } from '../../ui/GoogleButton';
import { Checkbox } from '../../ui/Checkbox';
import { TextLink } from '../../ui/TextLink';
import {
  useAuth,
  registerSchema,
  RegisterData,
} from '../../../core/hooks/useAuth';
import { useGoogleAuth } from '../../../core/hooks/useGoogleAuth';
import { isUsernameAvailable } from '../../../core/auth/registerUsername.logic';
import { classifySignUpResult } from '../../../core/auth/authOutcome.logic';
import {
  ACCOUNT_EXISTS_KEY,
  USERNAME_TAKEN_KEY,
  mapAuthErrorKey,
} from '../../../core/auth/authErrors.logic';
import { supabase } from '../../../core/db/supabase';

type RegisterFormProps = {
  onSuccess: (email: string) => void;
  onAccountExists: () => void;
  onLoginPress: () => void;
};

export const RegisterForm = ({
  onSuccess,
  onAccountExists,
  onLoginPress,
}: RegisterFormProps) => {
  const { t } = useTranslation('auth');
  const { signUp, loading } = useAuth();

  // 1. RESTAURACIÓN DE REFS (Para navegación de teclado)
  const emailInputRef = useRef<RNTextInput>(null);
  const passwordInputRef = useRef<RNTextInput>(null);
  const confirmPasswordInputRef = useRef<RNTextInput>(null);

  // 2. MOTOR DE GOOGLE
  const { signInWithGoogle, isGoogleLoading } = useGoogleAuth(() => {
    router.replace('/(tabs)');
  });

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid },
  } = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    mode: 'onChange',
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      termsAccepted: false,
    },
  });

  const onSubmit = async (data: RegisterData) => {
    // Pre-check so a taken username is a field error, not a failed signup. The
    // signup trigger stays the authority if this lookup is inconclusive.
    const availability = await isUsernameAvailable(supabase, data.username);
    if (availability === 'taken') {
      setError('username', { message: 'auth:errors.usernameAlreadyTaken' });
      return;
    }

    const result = await signUp(data);
    if (!result.success) {
      const key = result.error?.messageKey ?? mapAuthErrorKey(null);
      if (key === USERNAME_TAKEN_KEY) {
        setError('username', { message: USERNAME_TAKEN_KEY });
        return;
      }
      if (key === ACCOUNT_EXISTS_KEY) {
        Toast.show({
          type: 'info',
          text1: t('accountAlreadyExistsTitle'),
          text2: t('accountAlreadyExistsMsg'),
        });
        onAccountExists();
        return;
      }
      Toast.show({
        type: 'error',
        text1: t('registerErrorTitle'),
        text2: t(key),
      });
      return;
    }
    const outcome = classifySignUpResult(result);
    if (outcome === 'account_exists') {
      Toast.show({
        type: 'info',
        text1: t('accountAlreadyExistsTitle'),
        text2: t('accountAlreadyExistsMsg'),
      });
      onAccountExists();
      return;
    }
    if (outcome === 'verify') onSuccess(data.email);
  };

  const isBusy = loading || isGoogleLoading;

  // Keyboard "Done" applies the same guard as the register button.
  const submitFromKeyboard = () => {
    if (!isValid || isBusy) return;
    void handleSubmit(onSubmit)();
  };

  // Helper para renderizar el label de términos (Asumo que ya lo tienes)
  const renderTermsLabel = () => (
    <Text variant="body-md" color="textSecondary">
      {t('iHaveReadAndAccept')}{' '}
      <Text color="primary" fontWeight="bold">
        {t('termsAndConditions')}
      </Text>
    </Text>
  );

  return (
    <Box width="100%">
      <Box>
        {/* USERNAME */}
        <Controller
          control={control}
          name="username"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              label={t('usernameLabel')}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              autoCapitalize="none"
              autoComplete="username"
              textContentType="username"
              leftIcon="account-circle-outline"
              error={!!errors.username}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={() => emailInputRef.current?.focus()} // <--- SALTO 1
            />
          )}
        />
        {errors.username && (
          <Text variant="body-sm" color="error" marginTop="s" marginLeft="s">
            {t(errors.username.message as string)}
          </Text>
        )}

        <Box height={16} />

        {/* EMAIL */}
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              ref={emailInputRef} // <--- ASIGNACIÓN 1
              label={t('emailLabel')}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              leftIcon="email-outline"
              error={!!errors.email}
              returnKeyType="next"
              onSubmitEditing={() => passwordInputRef.current?.focus()} // <--- SALTO 2
            />
          )}
        />
        {errors.email && (
          <Text variant="body-sm" color="error" marginTop="s" marginLeft="s">
            {t(errors.email.message as string)}
          </Text>
        )}

        <Box height={16} />

        {/* PASSWORD */}
        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              ref={passwordInputRef} // <--- ASIGNACIÓN 2
              label={t('passwordLabel')}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              leftIcon="lock-outline"
              error={!!errors.password}
              returnKeyType="next"
              onSubmitEditing={() => confirmPasswordInputRef.current?.focus()} // <--- SALTO 3
            />
          )}
        />
        {errors.password && (
          <Text variant="body-sm" color="error" marginTop="s" marginLeft="s">
            {t(errors.password.message as string)}
          </Text>
        )}

        <Box height={16} />

        {/* CONFIRM PASSWORD */}
        <Controller
          control={control}
          name="confirmPassword"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              ref={confirmPasswordInputRef} // <--- ASIGNACIÓN 3
              label={t('confirmPasswordLabel')}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              leftIcon="lock-check-outline"
              error={!!errors.confirmPassword}
              returnKeyType="done"
              onSubmitEditing={submitFromKeyboard}
            />
          )}
        />
        {errors.confirmPassword && (
          <Text variant="body-sm" color="error" marginTop="s" marginLeft="s">
            {t(errors.confirmPassword.message as string)}
          </Text>
        )}

        <Box height={24} />

        {/* TERMS */}
        <Controller
          control={control}
          name="termsAccepted"
          render={({ field: { onChange, value } }) => (
            <Checkbox
              status={value ? 'checked' : 'unchecked'}
              onPress={() => onChange(!value)}
              label={renderTermsLabel()}
            />
          )}
        />
      </Box>

      {/* BOTONES DE ACCIÓN */}
      <Box paddingVertical="m">
        <PrimaryButton
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          disabled={!isValid || isBusy}
        >
          {t('createAccountButton')}
        </PrimaryButton>
      </Box>

      <Box flexDirection="row" alignItems="center" marginBottom="l">
        <Box flex={1} height={1} backgroundColor="cardBackground" />
        <Text variant="body-sm" marginHorizontal="m">
          {t('or')}
        </Text>
        <Box flex={1} height={1} backgroundColor="cardBackground" />
      </Box>

      {/* FIX: GoogleButton sin la prop loading si no la soporta */}
      <GoogleButton
        onPress={() => !isBusy && signInWithGoogle()} // Protección manual
        label={
          isGoogleLoading ? t('common:states.loading') : t('continueWithGoogle')
        }
        disabled={isBusy}
      />

      <Box
        paddingVertical="l"
        alignItems="center"
        flexDirection="row"
        justifyContent="center"
      >
        <Text variant="body-md" color="textSecondary">
          {t('alreadyHaveAccount')}{' '}
        </Text>
        <TextLink onPress={onLoginPress}>{t('loginButton')}</TextLink>
      </Box>
    </Box>
  );
};
