/**
 * @file core/auth/authOutcome.logic.ts
 * @description Pure decisions for the login and signup outcomes: which error
 * means "unconfirmed email" and which signup result means "account exists".
 * Side effects (resend, navigation) are injected.
 */

export type LoginErrorKind = 'email_not_confirmed' | 'other';

/** Supabase Auth error code (`AuthError.code`) for an unconfirmed email. */
const EMAIL_NOT_CONFIRMED_CODE = 'email_not_confirmed';

export const classifyLoginError = (
  error: { code?: string | null; message?: string } | null,
): LoginErrorKind =>
  error?.code === EMAIL_NOT_CONFIRMED_CODE ? 'email_not_confirmed' : 'other';

type RecoverDeps = {
  resend: (email: string) => Promise<{ success: boolean }>;
  openVerification: (email: string) => void;
};

/**
 * Resend the signup code and open the verification screen. A failed resend
 * never blocks the screen: the user can press resend there.
 */
export const recoverUnconfirmedLogin = async (
  email: string,
  deps: RecoverDeps,
): Promise<void> => {
  try {
    await deps.resend(email);
  } catch {
    // Ignored on purpose, see above.
  }
  deps.openVerification(email);
};

export type SignUpOutcome = 'account_exists' | 'verify' | 'none';

type SignUpResultLike = {
  user: { identities?: unknown[] | null } | null;
  session: unknown | null;
};

/**
 * With email confirmation on, Supabase answers a signup for an existing email
 * with a user whose `identities` is an empty array and no session (it does not
 * reveal the account through an error). Anything else keeps the old flow.
 */
export const classifySignUpResult = (
  result: SignUpResultLike,
): SignUpOutcome => {
  if (!result.user) return result.session ? 'verify' : 'none';
  if (
    !result.session &&
    Array.isArray(result.user.identities) &&
    result.user.identities.length === 0
  ) {
    return 'account_exists';
  }
  return 'verify';
};
