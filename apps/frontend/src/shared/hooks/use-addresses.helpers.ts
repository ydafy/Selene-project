import type { Address } from '@selene/types';
import type { supabase } from '../lib/supabase';

export type PendingAddress = Omit<Address, 'id' | 'user_id'> & {
  street_number: string;
};

/**
 * Inserts an address for `userId`. The first address always becomes the
 * default. A user holds one default live address
 * (`addresses_one_default_per_user_idx`), so a new default first clears the
 * current one. The two calls are not atomic: if the insert fails after the
 * clear, the user is left without a default, which the app tolerates (it
 * falls back to the first address).
 */
export const insertAddress = async (
  client: typeof supabase,
  userId: string,
  newAddress: PendingAddress,
  isFirst: boolean,
) => {
  const isDefault = isFirst || newAddress.is_default;

  if (isDefault) {
    const { error: clearError } = await client
      .from('addresses')
      .update({ is_default: false })
      .eq('user_id', userId)
      .eq('is_default', true);
    if (clearError) throw clearError;
  }

  const { data, error } = await client
    .from('addresses')
    .insert({
      ...newAddress,
      user_id: userId,
      is_default: isDefault,
    } as never)
    .select()
    .single();

  if (error) throw error;
  return data;
};
