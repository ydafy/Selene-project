import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * Static guards for the label deadline reminder call in auto-cancel-orders
 * (expo-push-notifications T7/S4). scripts/verify/test-auto-cancel-paid-timeout.ts drives the
 * served function and proves the notices it writes.
 */

// Prettier may re-wrap the source file; compare without layout.
const compact = (source: string) =>
  source
    .replace(/\s+/g, ' ')
    .replace(/([([{]) /g, '$1')
    .replace(/ ([)\]}])/g, '$1')
    .replace(/,([)\]}])/g, '$1')
    .replace(/ \./g, '.');

const flat = compact(
  readFileSync(
    new URL('../auto-cancel-orders/index.ts', import.meta.url),
    'utf8',
  ),
);

describe('auto-cancel-orders label deadline reminders', () => {
  const leaseAt = flat.indexOf(
    "acquireAutoCancelLease(supabaseAdmin, 'orders', log)",
  );
  const settingsAt = flat.indexOf(
    "if ('response' in settings) return settings.response;",
  );
  const reminderAt = flat.indexOf(
    "supabaseAdmin.rpc('fn_notify_label_deadline_reminders')",
  );
  const candidatesAt = flat.indexOf(".from('shipments')");
  const finallyAt = flat.indexOf('} finally {');

  test('calls the reminder RPC once, inside the lease, after the settings read and before any candidate query', () => {
    expect(flat.match(/fn_notify_label_deadline_reminders/g)).toHaveLength(1);
    expect(leaseAt).toBeGreaterThan(-1);
    expect(settingsAt).toBeGreaterThan(leaseAt);
    expect(reminderAt).toBeGreaterThan(settingsAt);
    expect(candidatesAt).toBeGreaterThan(reminderAt);
    expect(finallyAt).toBeGreaterThan(candidatesAt);
  });

  test('a failing reminder call only logs and the run continues', () => {
    const block = flat.slice(reminderAt, candidatesAt);
    expect(block).toContain(
      compact(`if (reminderError) {
        log('ERROR', 'Label deadline reminders failed', {
          error: reminderError.message,
        });
      }`),
    );
    expect(block).not.toContain('throw');
    expect(block).not.toContain('return');
  });

  test('both successful replies report how many reminders the run wrote', () => {
    expect(flat).toContain(
      compact(
        "JSON.stringify({ message: 'No shipments to cancel', reminded })",
      ),
    );
    expect(flat).toContain(
      compact(`JSON.stringify({
        processed: expiredShipments.length - deferred,
        success: successCount,
        deferred,
        reminded,
      })`),
    );
  });
});
