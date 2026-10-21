import { supabase } from '../db/supabase';
import { queryClient } from '../db/queryClient';
import { useCheckoutStore } from '../store/useCheckoutStore';
import { useCartStore } from '../store/useCartStore';
import { useDisputeStore } from '../store/useDisputeStore';
import { useSearchStore } from '../store/useSearchStore';
import { useProductHistoryStore } from '../store/useProductHistoryStore';
import { useSellStore } from '../store/useSellStore';
import { useReviewStore } from '../store/useReviewStore';
import {
  runCleanupSteps,
  runSignOut,
  type SignOutResult,
  type SignOutScope,
} from './signOut.logic';
import { resetUserQueries } from './userQueries.logic';

/**
 * Clears everything tied to the signed-in user. Device preferences such as
 * `useExperienceStore` are deliberately kept.
 */
export const clearUserScopedData = (): void =>
  runCleanupSteps([
    () => resetUserQueries(queryClient),
    () => useCheckoutStore.getState().resetCheckout(),
    () => useCartStore.getState().clearCart(),
    () => useDisputeStore.getState().reset(),
    () => useSearchStore.getState().clearHistory(),
    () => useProductHistoryStore.getState().clearHistory(),
    () => useSellStore.getState().resetDraft(),
    () => useReviewStore.getState().resetIgnored(),
  ]);

/** Single sign-out path. Routine logout is this device only. */
export const signOutUser = (
  scope: SignOutScope = 'local',
): Promise<SignOutResult> =>
  runSignOut({
    scope,
    signOut: (s) => supabase.auth.signOut({ scope: s }),
    cleanup: clearUserScopedData,
  });
