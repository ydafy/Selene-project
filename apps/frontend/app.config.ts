import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json with values that cannot be static.
 *
 * Push on Android needs Firebase's google-services.json. The repository is
 * public, so the file stays out of Git: EAS builds get it from the file
 * variable GOOGLE_SERVICES_JSON (EAS writes the file and sets the variable to
 * its path); local builds read the gitignored apps/frontend/google-services.json.
 */
export const resolveGoogleServicesFile = (
  env: Record<string, string | undefined>,
): string => env.GOOGLE_SERVICES_JSON || './google-services.json';

export default ({ config }: ConfigContext): ExpoConfig =>
  ({
    ...config,
    android: {
      ...config.android,
      googleServicesFile: resolveGoogleServicesFile(process.env),
    },
  }) as ExpoConfig;
