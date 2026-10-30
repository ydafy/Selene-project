/**
 * The only file that knows hCaptcha. Switching to Turnstile means replacing
 * this hook, `VITE_HCAPTCHA_SITE_KEY` and the Dashboard secret, never the login.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createCaptchaGetter, type CaptchaTokenSource } from './captcha.logic';
import {
  createHcaptchaLoader,
  createHcaptchaWidget,
  type HcaptchaMountedWidget,
} from './hcaptchaApi.logic';
import { createHcaptchaHandle } from './hcaptchaHandle.logic';

const SITE_KEY = String(import.meta.env.VITE_HCAPTCHA_SITE_KEY ?? '').trim();

const loadHcaptcha = createHcaptchaLoader(
  window as unknown as Parameters<typeof createHcaptchaLoader>[0],
  (src, onError) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onerror = onError;
    document.head.appendChild(script);
  },
);

export function useCaptcha(): {
  getToken: CaptchaTokenSource;
  widget: ReactNode;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HcaptchaMountedWidget | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!SITE_KEY || !container) return;
    const mounted = createHcaptchaWidget(loadHcaptcha, container, SITE_KEY);
    widgetRef.current = mounted;
    return () => {
      mounted.dispose();
      widgetRef.current = null;
    };
  }, []);

  const getToken = useMemo(
    () =>
      createCaptchaGetter(() =>
        createHcaptchaHandle(() => widgetRef.current, SITE_KEY !== ''),
      ),
    [],
  );

  const widget = SITE_KEY ? <div ref={containerRef} /> : null;

  return { getToken, widget };
}
