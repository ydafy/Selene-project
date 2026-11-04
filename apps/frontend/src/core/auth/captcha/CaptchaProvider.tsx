/**
 * @file core/auth/captcha/CaptchaProvider.tsx
 * @description The only file that knows hCaptcha. Mounted once at the app
 * root; switching to Turnstile means replacing this component, the site key
 * and the Dashboard secret, never the auth call sites.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import ConfirmHcaptcha from '@hcaptcha/react-native-hcaptcha';
import { useTranslation } from 'react-i18next';
import { registerCaptchaProvider } from './captcha';
import {
  CAPTCHA_CANCELLED_CODE,
  CAPTCHA_FAILED_CODE,
  CaptchaError,
} from './captcha.logic';
import {
  interpretHcaptchaEvent,
  type HcaptchaEventLike,
} from './hcaptchaEvent.logic';

const SITE_KEY = process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY?.trim() ?? '';

type Pending = {
  resolve: (token: string) => void;
  reject: (error: CaptchaError) => void;
};

export function CaptchaProvider({ children }: { children?: React.ReactNode }) {
  const { i18n } = useTranslation();
  const widget = useRef<ConfirmHcaptcha>(null);
  const pending = useRef<Pending | null>(null);

  // The SDK unmounts its modal on hide, so every request gets a fresh widget and token.
  const request = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        pending.current?.reject(new CaptchaError(CAPTCHA_CANCELLED_CODE));
        pending.current = { resolve, reject };
        widget.current?.show();
      }),
    [],
  );

  // A timed-out challenge must not stay on screen or answer a later request.
  const cancel = useCallback(() => {
    pending.current = null;
    widget.current?.hide();
  }, []);

  useEffect(
    () => registerCaptchaProvider({ configured: !!SITE_KEY, request, cancel }),
    [request, cancel],
  );

  const onMessage = useCallback((event: HcaptchaEventLike) => {
    const outcome = interpretHcaptchaEvent(event);
    const current = pending.current;
    // Late events (e.g. token expiry after use) must not close another challenge.
    if (outcome.kind === 'pending' || !current) return;

    pending.current = null;
    (event as { markUsed?: () => void }).markUsed?.();
    widget.current?.hide();
    if (outcome.kind === 'token') {
      current.resolve(outcome.token);
      return;
    }
    current.reject(
      new CaptchaError(
        outcome.kind === 'cancelled'
          ? CAPTCHA_CANCELLED_CODE
          : CAPTCHA_FAILED_CODE,
      ),
    );
  }, []);

  return (
    <>
      {children}
      {SITE_KEY ? (
        <ConfirmHcaptcha
          ref={widget}
          siteKey={SITE_KEY}
          baseUrl="https://hcaptcha.com"
          size="invisible"
          languageCode={i18n.language}
          onMessage={onMessage}
        />
      ) : null}
    </>
  );
}
