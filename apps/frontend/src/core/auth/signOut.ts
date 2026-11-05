import { supabase } from '../../shared/lib/supabase';
import { queryClient } from '../../shared/lib/query-client';
import { useCheckoutStore } from '../../features/checkout/store/use-checkout-store';
import { useCartStore } from '../../features/cart/store/use-cart-store';
import { useDisputeStore } from '../../features/orders/store/use-dispute-store';
import { useSearchStore } from '../../features/search/store/use-search-store';
import { useProductHistoryStore } from '../../shared/store/use-product-history-store';
import { useSellStore } from '../../features/sell/store/use-sell-store';
import { useReviewStore } from '../../features/orders/store/use-review-store';
import {
  runCleanupSteps,
  runSignOut,
  type SignOutResult,
  type SignOutScope,
} from './signOut.logic';
import { pushRegistrar } from '../../features/notifications/lib/push-registration';
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
    unregisterPush: pushRegistrar.unregister,
    signOutFinished: pushRegistrar.signOutFinished,
  });
