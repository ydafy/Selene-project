import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputInstance,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Box, Text } from './base';

const OTP_LENGTH = 6;

export interface OtpInputHandle {
  clear: () => void;
}

interface OtpInputProps {
  /** Receives the digits typed so far (0 to 6 characters) on every change. */
  onChangeText: (code: string) => void;
}

/** Keeps digits only and cuts to the code length, so a pasted "123 456" fills the boxes. */
const sanitizeOtp = (text: string) =>
  text.replace(/\D/g, '').slice(0, OTP_LENGTH);

/**
 * Six-box one-time code field. One invisible TextInput owns the value, so the
 * keyboard's SMS and email code suggestions can fill it in a single step.
 */
export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(
  function OtpInput({ onChangeText }, ref) {
    const { t } = useTranslation('auth');
    const inputRef = useRef<TextInputInstance>(null);
    const [value, setValue] = useState('');
    const [focused, setFocused] = useState(false);

    const update = (text: string) => {
      const code = sanitizeOtp(text);
      setValue(code);
      onChangeText(code);
    };

    useImperativeHandle(ref, () => ({ clear: () => update('') }));

    const activeIndex = Math.min(value.length, OTP_LENGTH - 1);

    return (
      <Pressable
        onPress={() => inputRef.current?.focus()}
        accessible={false}
        style={styles.row}
      >
        {Array.from({ length: OTP_LENGTH }, (_, index) => (
          <Box
            key={index}
            width={35}
            height={50}
            alignItems="center"
            justifyContent="center"
            borderBottomWidth={2}
            borderBottomColor={
              focused && index === activeIndex ? 'primary' : 'textSecondary'
            }
          >
            <Text variant="subheader-lg">{value[index] ?? ''}</Text>
          </Box>
        ))}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={update}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          caretHidden
          accessibilityLabel={t('otpInputLabel')}
          style={styles.hiddenInput}
        />
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  hiddenInput: { ...StyleSheet.absoluteFill, opacity: 0 },
});
