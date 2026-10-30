/**
 * The only file that knows hCaptcha. Switching to Turnstile means replacing
 * this hook, `VITE_HCAPTCHA_SITE_KEY` and the Dashboard secret, never the login.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { createCaptchaGetter, type CaptchaTokenSource } from './captcha.logic';
import { createHcaptchaHandle } from './hcaptchaHandle.logic';

const SITE_KEY = String(import.meta.env.VITE_HCAPTCHA_SITE_KEY ?? '').trim();

export function useCaptcha(): { getToken: CaptchaTokenSource; widget: ReactNode } {
  const widgetRef = useRef<HCaptcha>(null);

  const getToken = useMemo(
    () => createCaptchaGetter(() => createHcaptchaHandle(() => widgetRef.current, SITE_KEY !== '')),
    [],
  );

  const widget = SITE_KEY ? (
    <HCaptcha ref={widgetRef} sitekey={SITE_KEY} size="invisible" languageOverride="es" />
  ) : null;

  return { getToken, widget };
}
