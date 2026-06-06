/**
 * @file core/utils/legalUrls.ts
 * @description Resolves Terms / Privacy URLs from EXPO_PUBLIC_* env with
 * placeholder defaults. Covers CONF-012, CONF-013.
 */

export const TERMS_URL_DEFAULT = 'https://selene.mx/terminos';
export const PRIVACY_URL_DEFAULT = 'https://selene.mx/privacidad';

export type LegalEnv = {
  EXPO_PUBLIC_TERMS_URL?: string;
  EXPO_PUBLIC_PRIVACY_URL?: string;
};

export type LegalUrls = {
  terms: string;
  privacy: string;
};

export const resolveLegalUrls = (env: LegalEnv): LegalUrls => ({
  terms: env.EXPO_PUBLIC_TERMS_URL?.trim() || TERMS_URL_DEFAULT,
  privacy: env.EXPO_PUBLIC_PRIVACY_URL?.trim() || PRIVACY_URL_DEFAULT,
});
