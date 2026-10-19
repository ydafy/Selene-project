import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '..');
const previous = readFileSync(
  join(migrationsDir, '20260917032655_add_connect_payout_failed_retry_contract.sql'),
  'utf8',
);
const canonical = () => readFileSync(
  join(migrationsDir, '../queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql'),
  'utf8',
);
const migration = () => {
  const file = readdirSync(migrationsDir).find((name) =>
    name.endsWith('_expose_payout_history_paid_at.sql'),
  );
  expect(file).toBeDefined();
  return readFileSync(join(migrationsDir, file!), 'utf8');
};
const view = (sql: string) => {
  const definition = sql.match(
    /CREATE OR REPLACE VIEW public\.admin_connect_payout_release_view[\s\S]+?\) payout_run ON TRUE;/,
  );
  expect(definition).not.toBeNull();
  return definition![0].replace(/\r\n/g, '\n');
};

describe('payout history paid_at SQL contract (structural, not PostgreSQL execution)', () => {
  test('appends the selected run payment timestamp without inventing a date', () => {
    const sql = view(migration());
    expect(sql).toContain('FALSE\n  ) AS requires_manual_review,\n  payout_run.paid_at AS payout_run_paid_at\nFROM');
    expect(sql).toContain('    pr.failed_at,\n    pr.paid_at,\n    pr.retry_of_run_id,');
    expect(sql).not.toMatch(/COALESCE\([^)]*paid_at|now\(\)|arrival_date/i);
  });

  test('preserves all previous view columns, amounts, eligibility and retry behavior', () => {
    const withoutDate = view(migration())
      .replace(',\n  payout_run.paid_at AS payout_run_paid_at', '')
      .replace('    pr.paid_at,\n', '');
    expect(withoutDate).toBe(view(previous));
  });

  test('keeps service-only security-invoker access and never writes stored payout data', () => {
    const sql = migration();
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
    expect(sql).toMatch(/WITH \(security_invoker = true\)/);
    expect(sql).toMatch(/REVOKE ALL ON public\.admin_connect_payout_release_view FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT SELECT ON public\.admin_connect_payout_release_view TO service_role;/);
    expect(sql).not.toMatch(/\b(DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(sql).not.toMatch(/ALTER TABLE|CREATE.*FUNCTION|GRANT.*TO (PUBLIC|anon|authenticated)/i);
  });

  test('keeps the canonical operational view identical to the deployable view', () => {
    expect(view(canonical())).toBe(view(migration()));
  });
});
