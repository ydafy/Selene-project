/**
 * @file core/auth/reauth.logic.ts
 * @description Pure recent-sign-in step for sensitive actions (account
 * deletion, S8). A fresh sign-in gives the session a new `amr` timestamp,
 * which is what the Edge Function checks. The step must never switch the
 * user to a different account: it verifies the id and restores the previous
 * session otherwise.
 */

import { GENERIC_ERROR_KEY, mapAuthErrorKey } from './authErrors.logic';
import { resolveGoogleError } from './googleAuth.logic';

export type ReauthMethod = 'password' | 'google';

export type ReauthCredential =
  | { kind: 'password'; password: string }
  | { kind: 'google' };

export type ReauthResult =
  | { ok: true }
  /** `errorKey: null` means the user cancelled: nothing to show. */
  | { ok: false; errorKey: string | null; field?: 'password' };

export type ReauthSessionSnapshot = {
  userId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
};

type SignInOutcome = { userId: string | null; error: unknown };

export type ReauthDeps = {
  googleCancelledCode: string;
  getSnapshot: () => Promise<ReauthSessionSnapshot | null>;
  signInWithPassword: (email: string, password: string) => Promise<SignInOutcome>;
  signInWithGoogle: () => Promise<SignInOutcome>;
  /** Resolves true when the previous session is active again. */
  restoreSession: (snapshot: ReauthSessionSnapshot) => Promise<boolean>;
  signOutLocal: () => Promise<unknown>;
};

type IdentityUser = {
  identities?: { provider?: string }[] | null;
  app_metadata?: { provider?: string; providers?: string[] };
} | null;

const providersOf = (user: IdentityUser): string[] => {
  const fromIdentities = user?.identities
    ?.map((identity) => identity.provider)
    .filter((provider): provider is string => !!provider);
  if (fromIdentities?.length) return fromIdentities;
  const meta = user?.app_metadata;
  if (meta?.providers?.length) return meta.providers;
  return meta?.provider ? [meta.provider] : [];
};

/**
 * An email identity means the user holds a password; otherwise a Google
 * identity means Google. Identities are read first because
 * `app_metadata.provider` only names the first provider (C7).
 */
export const resolveReauthMethod = (user: IdentityUser): ReauthMethod => {
  const providers = providersOf(user);
  if (providers.includes('email')) return 'password';
  return providers.includes('google') ? 'google' : 'password';
};

const WRONG_PASSWORD_KEY = 'settings:errors.wrongPassword';
const AUTH_REQUIRED_KEY = 'settings:errors.authRequired';
const ACCOUNT_MISMATCH_KEY = 'settings:errors.accountMismatch';

const passwordErrorKey = (error: unknown): string => {
  const key = mapAuthErrorKey(error);
  return key === 'auth:errors.invalidCredentials' ? WRONG_PASSWORD_KEY : key;
};

export const reauthenticate = async (
  credential: ReauthCredential,
  deps: ReauthDeps,
): Promise<ReauthResult> => {
  const previous = await deps.getSnapshot();
  if (!previous) return { ok: false, errorKey: AUTH_REQUIRED_KEY };

  let outcome: SignInOutcome;
  if (credential.kind === 'password') {
    if (!previous.email) return { ok: false, errorKey: GENERIC_ERROR_KEY };
    outcome = await deps.signInWithPassword(previous.email, credential.password);
    if (outcome.error) {
      return {
        ok: false,
        errorKey: passwordErrorKey(outcome.error),
        field: 'password',
      };
    }
  } else {
    outcome = await deps.signInWithGoogle();
    if (outcome.error) {
      const resolution = resolveGoogleError(
        outcome.error,
        deps.googleCancelledCode,
      );
      return {
        ok: false,
        errorKey: resolution.silent ? null : resolution.key,
      };
    }
  }

  if (outcome.userId !== previous.userId) {
    // The sign-in switched the session to someone else: put the user back.
    const restored = await deps.restoreSession(previous).catch(() => false);
    if (!restored) await deps.signOutLocal();
    return { ok: false, errorKey: ACCOUNT_MISMATCH_KEY };
  }
  return { ok: true };
};
