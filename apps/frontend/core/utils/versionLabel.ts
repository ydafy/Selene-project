/**
 * @file core/utils/versionLabel.ts
 * @description Formats the app version label rendered on the settings screen.
 * Covers CONF-014: "Selene vX.Y.Z (Build N)" with "unknown" placeholders
 * when expo-constants returns null/undefined.
 */

const UNKNOWN = 'unknown';

const coerce = (value: unknown): string => {
  if (value === null || value === undefined) return UNKNOWN;
  const str = String(value).trim();
  return str.length === 0 ? UNKNOWN : str;
};

export const formatVersionLabel = (
  version: string | null | undefined,
  build: string | number | null | undefined,
): string => {
  return `Selene v${coerce(version)} (Build ${coerce(build)})`;
};
