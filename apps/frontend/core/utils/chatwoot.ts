/**
 * @file core/utils/chatwoot.ts
 * @description Pure helpers for the Chatwoot support entry (CONF-018).
 *
 * The mobile app prefers the native `@chatwoot/react-native-widget`. When
 * the widget is unavailable (Expo Go limitation, dev build missing the
 * native module, or runtime error), it falls back to opening a web URL
 * via `expo-web-browser`. This module provides:
 *   - resolveChatwootConfig: detect whether env config is complete
 *   - buildChatwootChatUrl:  build the web-fallback URL
 */

export type ChatwootEnv = {
  EXPO_PUBLIC_CHATWOOT_BASE_URL?: string;
  EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN?: string;
};

export type ChatwootConfig =
  | { available: false }
  | { available: true; baseUrl: string; websiteToken: string };

const nonEmpty = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const resolveChatwootConfig = (env: ChatwootEnv): ChatwootConfig => {
  const baseUrl = env.EXPO_PUBLIC_CHATWOOT_BASE_URL?.trim();
  const websiteToken = env.EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN?.trim();
  if (!nonEmpty(baseUrl) || !nonEmpty(websiteToken)) {
    return { available: false };
  }
  return { available: true, baseUrl, websiteToken };
};

export const buildChatwootChatUrl = (config: ChatwootConfig): string | null => {
  if (!config.available) return null;
  const cleanBase = config.baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/widget?website_token=${config.websiteToken}`;
};
