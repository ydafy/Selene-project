/**
 * @file core/auth/captcha/captcha.ts
 * @description Process-wide access to the mounted CAPTCHA provider, for the
 * auth calls that live outside React (hooks and `reauth.ts`).
 */

import {
  createCaptchaGetter,
  type CaptchaProviderHandle,
} from './captcha.logic';

let current: CaptchaProviderHandle | null = null;

/** Called by the provider component; returns the cleanup. */
export const registerCaptchaProvider = (
  handle: CaptchaProviderHandle,
): (() => void) => {
  current = handle;
  return () => {
    if (current === handle) current = null;
  };
};

export const getCaptchaToken = createCaptchaGetter(() => current);
