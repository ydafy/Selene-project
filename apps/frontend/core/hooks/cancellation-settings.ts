import type { Tables } from '@selene/types';

export const CANCELLATION_SETTINGS_FALLBACKS = {
  orderExpirationHours: 48,
  preparingExpirationHours: 72,
} as const;

export type CancellationSettings = {
  orderExpirationHours: number;
  preparingExpirationHours: number;
};

type SystemSettingsCancellationFields = Pick<
  Tables<'system_settings'>,
  'order_expiration_hours' | 'preparing_expiration_hours'
>;

export function resolveCancellationSettings(
  systemSettings: SystemSettingsCancellationFields | null | undefined,
): CancellationSettings {
  return {
    orderExpirationHours:
      systemSettings?.order_expiration_hours ??
      CANCELLATION_SETTINGS_FALLBACKS.orderExpirationHours,
    preparingExpirationHours:
      systemSettings?.preparing_expiration_hours ??
      CANCELLATION_SETTINGS_FALLBACKS.preparingExpirationHours,
  };
}
