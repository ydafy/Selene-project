/**
 * @file core/utils/supportEmail.ts
 * @description Pure helpers for the email support entry: users write to the
 * address in `EXPO_PUBLIC_SUPPORT_EMAIL` for questions and reports.
 */

export type SupportEmailEnv = {
  EXPO_PUBLIC_SUPPORT_EMAIL?: string;
};

// One "@", no spaces, and a dot in the domain: enough to reject placeholders
// and typos in the env value; the mail app validates the rest.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const resolveSupportEmail = (env: SupportEmailEnv): string | null => {
  const email = env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim();
  return email && EMAIL_PATTERN.test(email) ? email : null;
};

export const buildSupportMailto = (email: string, subject: string): string =>
  `mailto:${email}?subject=${encodeURIComponent(subject)}`;
