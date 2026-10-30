/**
 * The admin login's `CaptchaProviderHandle` over an hCaptcha widget. Kept out of
 * `useCaptcha.tsx` so the request and reset rules are testable without a DOM.
 */
import {
  CAPTCHA_CANCELLED_CODE,
  CaptchaError,
  toCaptchaError,
  type CaptchaProviderHandle,
} from './captcha.logic';

/** The slice of an hCaptcha widget the login uses (adapted in `hcaptchaApi.logic.ts`). */
export type HcaptchaWidgetLike = {
  execute: (options: { async: true }) => Promise<{ response: string }>;
  resetCaptcha: () => void;
};

/**
 * hCaptcha throws plain objects (`{ cause: 'missing-captcha' }`) when the widget is
 * gone. Resetting is best effort and must never replace the real result or error.
 */
const resetQuietly = (widget: HcaptchaWidgetLike | null): void => {
  try {
    widget?.resetCaptcha();
  } catch {
    // Nothing to reset.
  }
};

export const createHcaptchaHandle = (
  getWidget: () => HcaptchaWidgetLike | null,
  configured: boolean,
): CaptchaProviderHandle => ({
  configured,
  request: async () => {
    const widget = getWidget();
    if (!widget) throw new CaptchaError(CAPTCHA_CANCELLED_CODE);
    try {
      const { response } = await widget.execute({ async: true });
      return response;
    } catch (reason) {
      throw toCaptchaError(reason);
    } finally {
      // Tokens are single use: the next login needs a fresh challenge.
      resetQuietly(widget);
    }
  },
  // A timed-out challenge must not stay open over the login form.
  cancel: () => resetQuietly(getWidget()),
});
