/**
 * @file core/auth/registerUsername.logic.ts
 * @description Pure username rules for the registration form. The charset and
 * minimum come from the profile editor validator; the maximum is the
 * `profiles.username` CHECK (3..20) enforced by the signup trigger.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { validateEditUsername } from '../utils/editProfileValidation';

const MAX_LEN = 20;

export type RegisterUsernameValidation =
  { ok: true } | { ok: false; errorKey: string };

/**
 * Validate a typed username. Returns fully-qualified i18n keys so the result
 * can be used directly as a zod message.
 */
export const validateRegisterUsername = (
  raw: string,
): RegisterUsernameValidation => {
  const base = validateEditUsername(raw);
  if (!base.ok) {
    // The editor allows up to 30; the database only 20, checked below.
    return { ok: false, errorKey: `settings:${base.errorKey}` };
  }
  if (raw.trim().length > MAX_LEN) {
    return { ok: false, errorKey: 'settings:errors.usernameTooLong' };
  }
  return { ok: true };
};

export type UsernameAvailability = 'available' | 'taken' | 'unknown';

/**
 * Anonymous availability read against `profiles` (policy `profiles_public_read`).
 * `unknown` means the lookup failed: the caller proceeds and the signup trigger
 * stays the authority.
 */
export const isUsernameAvailable = async (
  client: SupabaseClient,
  raw: string,
): Promise<UsernameAvailability> => {
  const { data, error } = await client
    .from('profiles')
    .select('id')
    .eq('username', raw.trim())
    .limit(1);

  if (error || !data) return 'unknown';
  return data.length > 0 ? 'taken' : 'available';
};
