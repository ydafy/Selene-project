/**
 * @file core/utils/publicIdentity.ts
 * @description How another user's public identity is shown. A closed account
 * (`profiles.deleted_at` set) renders as a localized "deleted user" label with
 * no avatar and no link to the public profile.
 */

/**
 * `profiles.deleted_at` is not in the generated Supabase types until the
 * account-closure migration is applied and `bun run db:types` runs. Remove
 * this local extension then.
 */
export type PublicIdentitySource = {
  username?: string | null;
  avatar_url?: string | null;
  deleted_at?: string | null;
};

export type PublicIdentity = {
  isDeleted: boolean;
  /** Username, or the deleted-user label; null when the profile has no name. */
  displayName: string | null;
  avatarUrl: string | null;
  canOpenProfile: boolean;
};

// `fn_close_account` always renames the profile to `deleted_` + 12 hex chars.
// Only queries that do not load `deleted_at` fall back to that shape: a user
// can type the same string at registration, so a loaded `deleted_at` wins.
const CLOSED_USERNAME = /^deleted_[0-9a-f]{12}$/;

export const isClosedAccount = (
  profile: PublicIdentitySource | null | undefined,
): boolean => {
  if (!profile) return false;
  if (profile.deleted_at !== undefined) return profile.deleted_at !== null;
  return CLOSED_USERNAME.test(profile.username ?? '');
};

export const resolvePublicIdentity = (
  profile: PublicIdentitySource | null | undefined,
  deletedLabel: string,
): PublicIdentity => {
  if (!profile) {
    return {
      isDeleted: false,
      displayName: null,
      avatarUrl: null,
      canOpenProfile: false,
    };
  }
  if (isClosedAccount(profile)) {
    return {
      isDeleted: true,
      displayName: deletedLabel,
      avatarUrl: null,
      canOpenProfile: false,
    };
  }
  return {
    isDeleted: false,
    displayName: profile.username ?? null,
    avatarUrl: profile.avatar_url ?? null,
    canOpenProfile: true,
  };
};
