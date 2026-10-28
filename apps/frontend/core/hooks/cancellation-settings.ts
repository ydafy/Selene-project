import type { Tables } from '@selene/types';

// The backend fails closed when these settings are missing, so the app shows
// no countdown (null) instead of inventing a deadline.
export type CancellationSettings = {
  orderExpirationHours: number | null;
  preparingExpirationHours: number | null;
};

type SystemSettingsCancellationFields = Pick<
  Tables<'system_settings'>,
  'order_expiration_hours' | 'preparing_expiration_hours'
>;

export function resolveCancellationSettings(
  systemSettings: SystemSettingsCancellationFields | null | undefined,
): CancellationSettings {
  return {
    orderExpirationHours: systemSettings?.order_expiration_hours ?? null,
    preparingExpirationHours: systemSettings?.preparing_expiration_hours ?? null,
  };
}
