/**
 * @file supabase/functions/_shared/account-closure-cleanup.ts
 *
 * Stripe and Storage cleanup of a closed account (auth-hardening S8), shared by
 * `delete-account` (first attempt, right after the closure) and
 * `account-closure-cleanup` (cron retry). The decision logic is pure and works
 * on injected ports; `createSupabaseClosurePorts` wires the real clients.
 * Raw Stripe, database and Storage text never reaches a record or a log: only a
 * short machine code does.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import type { Database } from '../../../packages/types/src/database.types.ts';

/** Stripe codes that mean the object is already deleted, so the step is done. */
const GONE_CUSTOMER_CODES = ['resource_missing'] as const;
// Stripe answers a deleted connected account with `account_invalid` (observed in the
// sandbox), not `resource_missing`.
const GONE_ACCOUNT_CODES = ['resource_missing', 'account_invalid'] as const;

export const STORAGE_PAGE_SIZE = 100;
/** Passes over the avatar folder per attempt; a larger folder finishes on the next retry. */
export const MAX_AVATAR_PAGES = 20;

const AVATARS_BUCKET = 'Avatars';
const PRODUCTS_BUCKET = 'products';
const PRODUCT_URL_MARKER = `/storage/v1/object/public/${PRODUCTS_BUCKET}/`;

export type CleanupState = 'pending' | 'done' | 'failed' | 'not_needed';
const CLEANUP_STATES: readonly string[] = ['pending', 'done', 'failed', 'not_needed'];

/**
 * One write to `account_closures`. `attempt` adds one to `attempts` and stamps
 * `last_error`; `finish` only stamps `last_error` (the cron claim already counted).
 */
export type ClosureCleanupUpdate =
  | { stripe_customer_cleanup: 'done' | 'failed' | 'not_needed' }
  | { stripe_account_cleanup: 'done' | 'failed' | 'not_needed' }
  | { storage_cleanup: 'done' | 'failed' }
  | { attempt: true; last_error: string | null }
  | { finish: true; last_error: string | null };

export type ClosureCleanup = {
  customerId: string | null;
  accountId: string | null;
  customerCleanup: CleanupState;
  accountCleanup: CleanupState;
  storageCleanup: CleanupState;
};

export type ClosureCleanupPorts = {
  /** Throws on failure; an error with `code: 'resource_missing'` means it is already gone. */
  deleteStripeCustomer: (customerId: string) => Promise<void>;
  deleteStripeAccount: (accountId: string) => Promise<void>;
  /** Removes the avatar folder and the images of the listings the closure soft-deleted. */
  removeStorageFiles: (userId: string) => Promise<void>;
  recordCleanup: (userId: string, update: ClosureCleanupUpdate) => Promise<void>;
  log: (level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) => unknown;
};

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A short machine code that is safe to store and log; never the provider message. */
export function safeErrorCode(error: unknown): string {
  const code = asRecord(error)?.code;
  return typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? code : 'error';
}

const isCleanupState = (value: unknown): value is CleanupState =>
  typeof value === 'string' && CLEANUP_STATES.includes(value);

const needsWork = (state: CleanupState): boolean => state === 'pending' || state === 'failed';

/** Reads the Stripe ids and step states from the RPC result or an `account_closures` row. */
export function parseClosureCleanup(result: Record<string, unknown>): ClosureCleanup | null {
  const { stripe_customer_id: customerId, stripe_account_id: accountId } = result;
  const { stripe_customer_cleanup: customerCleanup, stripe_account_cleanup: accountCleanup } = result;
  const storageCleanup = result.storage_cleanup;
  if (
    (customerId !== null && typeof customerId !== 'string') ||
    (accountId !== null && typeof accountId !== 'string') ||
    !isCleanupState(customerCleanup) ||
    !isCleanupState(accountCleanup) ||
    !isCleanupState(storageCleanup)
  ) {
    return null;
  }
  return { customerId, accountId, customerCleanup, accountCleanup, storageCleanup };
}

/**
 * Runs the steps still `pending` or `failed` and records each result. A failed
 * step never throws: it is recorded `failed` for the next retry. With
 * `countAttempt: false` the caller already counted the attempt (cron claim).
 */
export async function runClosureCleanup(
  userId: string,
  closure: ClosureCleanup,
  ports: ClosureCleanupPorts,
  options: { countAttempt?: boolean } = {},
): Promise<{ failures: string[] }> {
  const countAttempt = options.countAttempt ?? true;
  const failures: string[] = [];
  let worked = false;

  /** Records one step result; a failed write is logged and never changes the outcome. */
  async function record(update: ClosureCleanupUpdate): Promise<void> {
    try {
      await ports.recordCleanup(userId, update);
    } catch {
      ports.log('ERROR', 'Account closure cleanup state not saved', { userId });
    }
  }

  const stripeStep = async (
    label: 'stripe_customer' | 'stripe_account',
    id: string | null,
    remove: (id: string) => Promise<void>,
    column: 'stripe_customer_cleanup' | 'stripe_account_cleanup',
    goneCodes: readonly string[],
  ) => {
    worked = true;
    if (id === null) return record({ [column]: 'not_needed' } as ClosureCleanupUpdate);
    try {
      await remove(id);
    } catch (error: unknown) {
      const code = safeErrorCode(error);
      if (!goneCodes.includes(code)) {
        failures.push(`${label}:${code}`);
        ports.log('WARN', 'Account closure cleanup step failed', { userId, step: label, code });
        return record({ [column]: 'failed' } as ClosureCleanupUpdate);
      }
    }
    return record({ [column]: 'done' } as ClosureCleanupUpdate);
  };

  if (needsWork(closure.customerCleanup)) {
    await stripeStep(
      'stripe_customer',
      closure.customerId,
      ports.deleteStripeCustomer,
      'stripe_customer_cleanup',
      GONE_CUSTOMER_CODES,
    );
  }
  if (needsWork(closure.accountCleanup)) {
    await stripeStep(
      'stripe_account',
      closure.accountId,
      ports.deleteStripeAccount,
      'stripe_account_cleanup',
      GONE_ACCOUNT_CODES,
    );
  }
  if (needsWork(closure.storageCleanup)) {
    worked = true;
    try {
      await ports.removeStorageFiles(userId);
      await record({ storage_cleanup: 'done' });
    } catch (error: unknown) {
      const code = safeErrorCode(error);
      failures.push(`storage:${code}`);
      ports.log('WARN', 'Account closure cleanup step failed', { userId, step: 'storage', code });
      await record({ storage_cleanup: 'failed' });
    }
  }

  if (worked) {
    const last_error = failures.length > 0 ? failures.join(';') : null;
    await record(countAttempt ? { attempt: true, last_error } : { finish: true, last_error });
  }
  return { failures };
}

/** Storage path of a public `products` URL, only when it lives in the user's own folder. */
export function ownProductPath(url: string, userId: string): string | null {
  const at = url.indexOf(PRODUCT_URL_MARKER);
  if (at < 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(at + PRODUCT_URL_MARKER.length).split('?')[0]);
  } catch {
    // A URL that does not decode points at nothing we could have written: skip it so
    // one bad value cannot fail the whole step on every retry.
    return null;
  }
  return path.startsWith(`${userId}/`) && !path.includes('..') ? path : null;
}

export type AvatarStorage = {
  /** File names directly inside `folder`, at most `limit`. */
  list: (folder: string, limit: number) => Promise<string[]>;
  remove: (paths: string[]) => Promise<void>;
};

export async function removeAvatarFolder(storage: AvatarStorage, userId: string): Promise<void> {
  // Each pass removes what it lists, so listing from 0 again reaches the rest.
  for (let page = 0; page < MAX_AVATAR_PAGES; page += 1) {
    const names = await storage.list(userId, STORAGE_PAGE_SIZE);
    if (names.length === 0) return;
    await storage.remove(names.map((name) => `${userId}/${name}`));
  }
  // Still not empty: fail the step so the next retry keeps going instead of looping here.
  throw Object.assign(new Error('avatar folder not empty after the page limit'), {
    code: 'storage_page_limit',
  });
}

export type ListingImagePorts = {
  /** Listings of the user that the closure soft-deleted. */
  listSoftDeletedProducts: (userId: string) => Promise<{ id: string; images: string[] | null }[]>;
  /** Of the given product ids, the ones that appear in an order item. */
  findOrderedProductIds: (productIds: string[]) => Promise<string[]>;
  removeProductImages: (paths: string[]) => Promise<void>;
};

// Images of the listings the closure soft-deleted: never-sold listings that are
// not in any order item. Listings tied to an order keep their images, and the
// `evidence` and `verification` buckets are not touched: they back orders and
// disputes that the ledger retention (5 years, S8) keeps for claims.
export async function removeListingImages(ports: ListingImagePorts, userId: string): Promise<void> {
  const products = await ports.listSoftDeletedProducts(userId);
  if (products.length === 0) return;

  const sold = new Set<string>();
  for (let i = 0; i < products.length; i += STORAGE_PAGE_SIZE) {
    const ids = products.slice(i, i + STORAGE_PAGE_SIZE).map((product) => product.id);
    for (const id of await ports.findOrderedProductIds(ids)) sold.add(id);
  }

  const paths = products
    .filter((product) => !sold.has(product.id))
    .flatMap((product) => product.images ?? [])
    .map((url) => ownProductPath(url, userId))
    .filter((path): path is string => path !== null);

  for (let i = 0; i < paths.length; i += STORAGE_PAGE_SIZE) {
    await ports.removeProductImages(paths.slice(i, i + STORAGE_PAGE_SIZE));
  }
}

/** The subset of the Stripe SDK the cleanup uses. */
export type StripeCleanupClient = {
  customers: { del: (id: string) => Promise<unknown> };
  accounts: { del: (id: string) => Promise<unknown> };
};

/**
 * Real ports over the Supabase admin client and Stripe. Both are created lazily so a
 * missing server config fails the request that needs it, not the import.
 */
export function createSupabaseClosurePorts(deps: {
  getAdmin: () => SupabaseClient<Database>;
  getStripe: () => StripeCleanupClient;
}): Pick<ClosureCleanupPorts, 'deleteStripeCustomer' | 'deleteStripeAccount' | 'removeStorageFiles' | 'recordCleanup'> {
  return {
    deleteStripeCustomer: async (customerId) => {
      await deps.getStripe().customers.del(customerId);
    },
    deleteStripeAccount: async (accountId) => {
      await deps.getStripe().accounts.del(accountId);
    },
    removeStorageFiles: async (userId) => {
      const admin = deps.getAdmin();
      const avatars = admin.storage.from(AVATARS_BUCKET);
      await removeAvatarFolder(
        {
          list: async (folder, limit) => {
            const { data, error } = await avatars.list(folder, { limit });
            if (error) throw new Error(error.message);
            return (data ?? []).map((file) => file.name);
          },
          remove: async (paths) => {
            const { error } = await avatars.remove(paths);
            if (error) throw new Error(error.message);
          },
        },
        userId,
      );
      await removeListingImages(
        {
          listSoftDeletedProducts: async (owner) => {
            const { data, error } = await admin
              .from('products')
              .select('id, images')
              .eq('seller_id', owner)
              .not('deleted_at', 'is', null);
            if (error) throw new Error(error.message);
            return data ?? [];
          },
          findOrderedProductIds: async (ids) => {
            const { data, error } = await admin.from('order_items').select('product_id').in('product_id', ids);
            if (error) throw new Error(error.message);
            return (data ?? []).map((item) => item.product_id);
          },
          removeProductImages: async (paths) => {
            const { error } = await admin.storage.from(PRODUCTS_BUCKET).remove(paths);
            if (error) throw new Error(error.message);
          },
        },
        userId,
      );
    },
    recordCleanup: async (userId, update) => {
      const admin = deps.getAdmin();
      if ('attempt' in update || 'finish' in update) {
        // One atomic UPDATE in the database: concurrent runs cannot undercount.
        const { error } = await admin.rpc('fn_record_closure_attempt', {
          p_user_id: userId,
          // The SQL argument accepts NULL (clears the error); the generator types every argument as non-null.
          p_last_error: update.last_error as string,
          p_count_attempt: 'attempt' in update,
        });
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await admin
        .from('account_closures')
        .update({ ...update, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
  };
}
