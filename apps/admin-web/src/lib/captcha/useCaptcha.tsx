/**
 * The only file that knows hCaptcha. Switching to Turnstile means replacing
 * this hook, `VITE_HCAPTCHA_SITE_KEY` and the Dashboard secret, never the login.
 */
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import {
  CAPTCHA_CANCELLED_CODE,
  CaptchaError,
  createCaptchaGetter,
  toCaptchaError,
  type CaptchaTokenSource,
} from './captcha.logic';

const SITE_KEY = String(import.meta.env.VITE_HCAPTCHA_SITE_KEY ?? '').trim();

export function useCaptcha(): { getToken: CaptchaTokenSource; widget: ReactNode } {
  const widgetRef = useRef<HCaptcha>(null);

  const request = useCallback(async () => {
    const widget = widgetRef.current;
    if (!widget) throw new CaptchaError(CAPTCHA_CANCELLED_CODE);
    try {
      const { response } = await widget.execute({ async: true });
      return response;
    } catch (reason) {
      throw toCaptchaError(reason);
    } finally {
      // Tokens are single use: the next login needs a fresh challenge.
      widget.resetCaptcha();
    }
  }, []);

  const getToken = useMemo(
    () =>
      createCaptchaGetter(() => ({
        configured: SITE_KEY !== '',
        request,
        // A timed-out challenge must not stay open over the login form.
        cancel: () => widgetRef.current?.resetCaptcha(),
      })),
    [request],
  );

  const widget = SITE_KEY ? (
    <HCaptcha ref={widgetRef} sitekey={SITE_KEY} size="invisible" languageOverride="es" />
  ) : null;

  return { getToken, widget };
}
