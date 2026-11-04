/**
 * @file core/auth/resendCooldown.logic.ts
 * @description Pure resend-code cooldown. The clock is always passed in so the
 * countdown is testable; the screen only renders `remainingSeconds`.
 */

import { isRateLimitError } from './authErrors.logic';

export const RESEND_COOLDOWN_SECONDS = 60;

/** Timestamp (ms) at which a cooldown started at `now` ends. */
export const cooldownEndsAt = (now: number): number =>
  now + RESEND_COOLDOWN_SECONDS * 1000;

/** Whole seconds left, rounded up; 0 when expired or never started. */
export const remainingSeconds = (endsAt: number | null, now: number): number =>
  endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));

/** A resend that went out, or that the server rate limited, starts the cooldown. */
export const shouldStartCooldown = (result: {
  success: boolean;
  error: { code?: string } | null;
}): boolean => result.success || isRateLimitError(result.error);
