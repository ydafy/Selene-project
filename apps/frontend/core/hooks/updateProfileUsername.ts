import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@selene/types';

/**
 * Pure mutation: update a user's username in the `profiles` table.
 * Kept free of React Query / hooks so it is unit-testable with a mock chain.
 */
export const updateProfileUsername = async (
  userId: string,
  username: string,
  client: SupabaseClient<Database>,
): Promise<void> => {
  const { error } = await client
    .from('profiles')
    .update({ username })
    .eq('id', userId);

  if (error) throw error;
};

/**
 * Map a Postgres / Supabase error to a localized i18n key.
 * - 23505 → unique violation → `settings:errors.usernameTaken`
 * - anything else → `settings:errors.updateFailed`
 */
export const mapUpdateProfileError = (
  error: { code?: string; message?: string } | null | undefined,
): string => {
  if (error && error.code === '23505') {
    return 'settings:errors.usernameTaken';
  }
  return 'settings:errors.updateFailed';
};
