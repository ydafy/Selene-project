/**
 * Adapts the hCaptcha explicit-render script (`window.hcaptcha`) to the
 * `HcaptchaWidgetLike` contract. Kept out of `useCaptcha.tsx` so loading, waiting
 * and unmount rules are testable without a DOM.
 */
import { CAPTCHA_CANCELLED_CODE, CaptchaError } from './captcha.logic';
import type { HcaptchaWidgetLike } from './hcaptchaHandle.logic';

export const HCAPTCHA_ONLOAD_CALLBACK = 'onHcaptchaApiLoaded';

export const hcaptchaScriptUrl = (): string =>
  `https://js.hcaptcha.com/1/api.js?render=explicit&onload=${HCAPTCHA_ONLOAD_CALLBACK}&hl=es`;

type LoaderWindow = { hcaptcha?: HcaptchaApi } & Record<string, unknown>;

/**
 * Loads the script at most once and reuses an existing `window.hcaptcha`. A failed
 * load is forgotten so the next request tries again.
 */
export const createHcaptchaLoader = (
  win: LoaderWindow,
  appendScript: (src: string, onError: () => void) => void,
): (() => Promise<HcaptchaApi>) => {
  let pending: Promise<HcaptchaApi> | null = null;
  return () => {
    if (win.hcaptcha) return Promise.resolve(win.hcaptcha);
    pending ??= new Promise<HcaptchaApi>((resolve, reject) => {
      win[HCAPTCHA_ONLOAD_CALLBACK] = () => {
        if (win.hcaptcha) resolve(win.hcaptcha);
        else reject(new Error('hcaptcha_missing'));
      };
      appendScript(hcaptchaScriptUrl(), () =>
        reject(new Error('hcaptcha_script_failed')),
      );
    }).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
};

export type HcaptchaMountedWidget = HcaptchaWidgetLike & {
  /** Removes the rendered widget; safe before the API is ready and when called twice. */
  dispose: () => void;
};

/**
 * Renders lazily: a request made before the API is ready waits for it instead of
 * failing. After `dispose` every request is cancelled.
 */
export const createHcaptchaWidget = (
  load: () => Promise<HcaptchaApi>,
  container: HTMLElement,
  sitekey: string,
): HcaptchaMountedWidget => {
  let disposed = false;
  let rendered: { api: HcaptchaApi; id: string } | null = null;
  let ready: Promise<{ api: HcaptchaApi; id: string }> | null = null;

  const ensure = () => {
    ready ??= load()
      .then((api) => {
        if (disposed) throw new CaptchaError(CAPTCHA_CANCELLED_CODE);
        rendered = {
          api,
          id: api.render(container, { sitekey, size: 'invisible' }),
        };
        return rendered;
      })
      .catch((error: unknown) => {
        // A failed load must not stick: the next request tries again.
        ready = null;
        throw error;
      });
    return ready;
  };

  return {
    execute: async (options) => {
      const { api, id } = await ensure();
      if (disposed) throw new CaptchaError(CAPTCHA_CANCELLED_CODE);
      return api.execute(id, options);
    },
    resetCaptcha: () => {
      if (rendered && !disposed) rendered.api.reset(rendered.id);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (rendered) {
        try {
          rendered.api.remove(rendered.id);
        } catch {
          // The widget may already be gone; unmounting must not throw.
        }
      }
    },
  };
};
