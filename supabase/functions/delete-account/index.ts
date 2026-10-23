import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { withSentry } from '../_shared/sentry.ts';
import { createDeleteAccountHandler, type ClosureCleanupUpdate } from './handler.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';
const AVATARS_BUCKET = 'Avatars';
const PRODUCTS_BUCKET = 'products';
const PRODUCT_URL_MARKER = `/storage/v1/object/public/${PRODUCTS_BUCKET}/`;
const PAGE_SIZE = 100;

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'delete-account',
      level,
      msg,
      ...data,
    }),
  );
};

// Lazy: a missing server config is a 500 for the request, not a crash at import time.
const getAdminClient = () => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('MISSING_SERVER_CONFIG');
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

const getStripe = () => {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) throw new Error('MISSING_SERVER_CONFIG');
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
};

// `account_closures` is not in the generated types until `bun run db:types`
// runs after the T5a migration is applied.
type ClosureTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => Promise<{
        data: { attempts: number } | null;
        error: { message: string } | null;
      }>;
    };
  };
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
  };
};
const closures = () => getAdminClient().from('account_closures' as never) as unknown as ClosureTable;

async function recordCleanup(userId: string, update: ClosureCleanupUpdate) {
  const now = new Date().toISOString();
  let values: Record<string, unknown> = { ...update, updated_at: now };
  if ('attempt' in update) {
    const { data, error } = await closures().select('attempts').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    values = {
      attempts: (data?.attempts ?? 0) + 1,
      last_error: update.last_error,
      updated_at: now,
    };
  }
  const { error } = await closures().update(values).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/** Storage path of a public `products` URL, only when it lives in the user's own folder. */
function ownProductPath(url: string, userId: string): string | null {
  const at = url.indexOf(PRODUCT_URL_MARKER);
  if (at < 0) return null;
  const path = decodeURIComponent(url.slice(at + PRODUCT_URL_MARKER.length).split('?')[0]);
  return path.startsWith(`${userId}/`) && !path.includes('..') ? path : null;
}

async function removeAvatarFolder(userId: string) {
  const storage = getAdminClient().storage.from(AVATARS_BUCKET);
  // Each pass removes what it lists, so listing from 0 again reaches the rest.
  for (;;) {
    const { data, error } = await storage.list(userId, { limit: PAGE_SIZE });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return;
    const { error: removeError } = await storage.remove(data.map((file) => `${userId}/${file.name}`));
    if (removeError) throw new Error(removeError.message);
  }
}

// Images of the listings the closure soft-deleted: never-sold listings that are
// not in any order item. Listings tied to an order keep their images, and the
// `evidence` and `verification` buckets are not touched: they back orders and
// disputes that the ledger retention (5 years, S8) keeps for claims.
async function removeListingImages(userId: string) {
  const admin = getAdminClient();
  const { data: products, error } = await admin
    .from('products')
    .select('id, images')
    .eq('seller_id', userId)
    .not('deleted_at', 'is', null);
  if (error) throw new Error(error.message);
  if (!products || products.length === 0) return;

  const sold = new Set<string>();
  for (let i = 0; i < products.length; i += PAGE_SIZE) {
    const ids = products.slice(i, i + PAGE_SIZE).map((product) => product.id);
    const { data: items, error: itemsError } = await admin
      .from('order_items')
      .select('product_id')
      .in('product_id', ids);
    if (itemsError) throw new Error(itemsError.message);
    for (const item of items ?? []) sold.add(item.product_id);
  }

  const paths = products
    .filter((product) => !sold.has(product.id))
    .flatMap((product) => product.images ?? [])
    .map((url) => ownProductPath(url, userId))
    .filter((path): path is string => path !== null);

  for (let i = 0; i < paths.length; i += PAGE_SIZE) {
    const { error: removeError } = await admin.storage
      .from(PRODUCTS_BUCKET)
      .remove(paths.slice(i, i + PAGE_SIZE));
    if (removeError) throw new Error(removeError.message);
  }
}

const handler = createDeleteAccountHandler({
  getUserId: async (accessToken) => {
    const {
      data: { user },
      error,
    } = await getAdminClient().auth.getUser(accessToken);
    return error || !user ? null : user.id;
  },
  now: () => Date.now(),
  closeAccount: async (userId) => {
    // The RPC is not in the generated types until `bun run db:types` runs after it is applied.
    const { data, error } = await getAdminClient().rpc('fn_close_account' as never, {
      p_user_id: userId,
    } as never);
    return { data: data as unknown, error };
  },
  deleteStripeCustomer: async (customerId) => {
    await getStripe().customers.del(customerId);
  },
  deleteStripeAccount: async (accountId) => {
    await getStripe().accounts.del(accountId);
  },
  removeStorageFiles: async (userId) => {
    await removeAvatarFolder(userId);
    await removeListingImages(userId);
  },
  recordCleanup,
  log,
});

serve(withSentry('delete-account', handler));
