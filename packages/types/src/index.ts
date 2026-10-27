// Entry point for the apps (`@selene/types`): every shared type plus the domain constants.
// Edge Functions import types.ts directly: Deno cannot resolve the extensionless
// './domain' import below, which the app typecheck requires.
export type * from './types.ts';

export {
  ACCOUNT_DELETION_PATH,
  ACCOUNT_DELETION_URL,
  PRIVACY_PATH,
  PRIVACY_URL,
  SELENE_DOMAIN,
  SELENE_SUPPORT_EMAIL,
  SELENE_WEB_URL,
} from './domain';
