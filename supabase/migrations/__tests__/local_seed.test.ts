import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const seed = readFileSync(
  join(import.meta.dir, '..', '..', 'seed.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('local seed (SQL structural only)', () => {
  test('only creates accounts on the reserved local domain', () => {
    const emails = seed.match(/'[^'@\s]+@[^'\s]+'/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(email.endsWith("@selene.local'")).toBe(true);
    }
  });

  test('never carries a real secret', () => {
    expect(seed).not.toMatch(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk_(live|test)_|rk_(live|test)_|whsec_|sb_secret_/,
    );
  });

  test('starts every cron running flag as false', () => {
    const settings = seed.slice(
      seed.indexOf('INSERT INTO public.system_settings'),
      seed.indexOf('ON CONFLICT (id) DO NOTHING;'),
    );
    expect(settings).toContain('auto_cancel_orders_running');
    expect(settings).toContain('checkout_recovery_running');
    const values = settings.slice(settings.indexOf(') VALUES ('));
    expect(values.trimEnd().endsWith('true, false\n)')).toBe(true);
  });

  test('derives publication economics from system_settings instead of hardcoding them', () => {
    expect(seed).toContain(
      'public.normalize_publication_rate(s.insurance_rate)',
    );
    expect(seed).toContain(
      'public.normalize_publication_rate(s.service_fee_pct)',
    );
    expect(seed).toContain('s.shipping_buffer_cents');
  });
});
