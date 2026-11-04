/**
 * @file core/auth/captcha/hcaptchaEvent.logic.ts
 * @description Maps `@hcaptcha/react-native-hcaptcha` `onMessage` events to a
 * provider-neutral outcome. Only the hCaptcha provider imports this file.
 */

export type HcaptchaEventLike = {
  success?: boolean;
  nativeEvent?: { data?: string };
};

export type HcaptchaOutcome =
  | { kind: 'token'; token: string }
  | { kind: 'cancelled' }
  | { kind: 'failed' }
  /** Not final (the challenge opened): keep waiting. */
  | { kind: 'pending' };

/** `cancel` comes from the back button or backdrop; `challenge-closed` from the widget. */
const CANCEL_EVENTS = ['cancel', 'challenge-closed'];

export const interpretHcaptchaEvent = (
  event: HcaptchaEventLike,
): HcaptchaOutcome => {
  const data = event.nativeEvent?.data;
  if (!data || data === 'open') return { kind: 'pending' };
  if (event.success) return { kind: 'token', token: data };
  if (CANCEL_EVENTS.includes(data)) return { kind: 'cancelled' };
  // Everything else is an SDK error code (expired, network-error, ...).
  return { kind: 'failed' };
};
