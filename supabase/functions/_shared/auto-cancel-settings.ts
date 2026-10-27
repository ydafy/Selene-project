import type { AutoCancelLeaseLog } from './auto-cancel-lease.ts';

export type AutoCancelHoursColumn =
  | 'order_expiration_hours'
  | 'preparing_expiration_hours';

type SettingsRead = PromiseLike<{ data: unknown; error: unknown }>;

export interface AutoCancelSettingsClient {
  from: (table: 'system_settings') => {
    select: (column: AutoCancelHoursColumn) => { single: () => SettingsRead };
  };
}

/**
 * Reads the expiration window for an auto-cancel cron. Fails closed: a failed read or a value
 * that is not a positive integer never falls back to a default, it returns the 500 response.
 */
export async function readAutoCancelExpirationHours(
  client: AutoCancelSettingsClient,
  column: AutoCancelHoursColumn,
  log: AutoCancelLeaseLog,
): Promise<{ hours: number } | { response: Response }> {
  const { data, error } = await client
    .from('system_settings')
    .select(column)
    .single();

  const hours = (data as Record<string, unknown> | null)?.[column];
  if (
    error ||
    typeof hours !== 'number' ||
    !Number.isInteger(hours) ||
    hours <= 0
  ) {
    log('ERROR', 'Auto-cancel settings invalid', {
      setting: column,
      value: hours ?? null,
    });
    return {
      response: new Response(
        JSON.stringify({ error: 'AUTO_CANCEL_SETTINGS_INVALID' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    };
  }
  return { hours };
}
