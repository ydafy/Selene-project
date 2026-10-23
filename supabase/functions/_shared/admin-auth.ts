/**
 * @file supabase/functions/_shared/admin-auth.ts
 *
 * Admin check shared by the admin-only Edge Functions. Roles live in
 * `profiles_private.role`, never in JWT claims; callers select `role, status`.
 */

/** Same rule as SQL is_admin(): admin role and an active account (NULL status counts as active). */
export const isActiveAdmin = (
  row: { role?: unknown; status?: unknown } | null,
): boolean => row !== null && row.role === 'admin' && (row.status ?? 'active') === 'active';
