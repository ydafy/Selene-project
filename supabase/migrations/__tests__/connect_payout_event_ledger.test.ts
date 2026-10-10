import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const readEventLedgerMigration = (): string => {
  const migrationFile = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('_connect_payout_event_ledger.sql'))
    .sort()
    .pop();

  if (!migrationFile) {
    throw new Error('Connect payout event ledger migration not found');
  }

  return readFileSync(join(MIGRATIONS_DIR, migrationFile), 'utf8');
};

describe('connect payout event ledger migration', () => {
  test('creates a service-role-only immutable payout event evidence table', () => {
    const sql = readEventLedgerMigration();

    expect(sql).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.connect_payout_events/i,
    );
    expect(sql).toMatch(/stripe_event_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
    expect(sql).toMatch(/event_type\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/stripe_payout_id\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/connect_payout_run_id\s+UUID/i);
    expect(sql).toMatch(
      /REFERENCES\s+public\.connect_payout_runs\s*\(\s*id\s*\)/i,
    );
  });

  test('records Stripe occurrence time, receipt time, and observed payout state', () => {
    const sql = readEventLedgerMigration();

    expect(sql).toMatch(/stripe_created\s+TIMESTAMPTZ\s+NOT\s+NULL/i);
    expect(sql).toMatch(/received_at\s+TIMESTAMPTZ\s+NOT\s+NULL/i);
    expect(sql).toMatch(
      /observed_payout_status\s+TEXT\s+NOT\s+NULL/i,
    );
    expect(sql).toMatch(
      /observed_payout_status[\s\S]{0,400}CHECK[\s\S]{0,400}'pending'[\s\S]{0,400}'in_transit'[\s\S]{0,400}'paid'[\s\S]{0,400}'failed'[\s\S]{0,400}'canceled'/i,
    );
  });

  test('carries failure code, message, and balance-transaction evidence', () => {
    const sql = readEventLedgerMigration();

    expect(sql).toMatch(/failure_code\s+TEXT/i);
    expect(sql).toMatch(/failure_message\s+TEXT/i);
    expect(sql).toMatch(/failure_balance_transaction\s+TEXT/i);
  });

  test('constrains supported payout event types', () => {
    const sql = readEventLedgerMigration();

    expect(sql).toMatch(
      /event_type[\s\S]{0,400}CHECK[\s\S]{0,400}'payout\.created'[\s\S]{0,400}'payout\.updated'[\s\S]{0,400}'payout\.paid'[\s\S]{0,400}'payout\.failed'[\s\S]{0,400}'payout\.canceled'/i,
    );
  });

  test('adds required lookup and occurrence-order indexes', () => {
    const sql = readEventLedgerMigration();

    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_connect_payout_events_stripe_payout_id\s+ON\s+public\.connect_payout_events\s*\(\s*stripe_payout_id\s*,\s*stripe_created\s*\)/i,
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_connect_payout_events_run_id[\s\S]+ON\s+public\.connect_payout_events\s*\(\s*connect_payout_run_id\s*\)/i,
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_connect_payout_events_event_type/i,
    );
  });

  test('enforces append-only evidence with a mutation-blocking trigger', () => {
    const sql = readEventLedgerMigration();

    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_connect_payout_events_append_only[\s\S]+BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.connect_payout_events/i,
    );
    expect(sql).toMatch(
      /RAISE\s+EXCEPTION[\s\S]*append-only[\s\S]*immutable/i,
    );
  });

  test('adds an idempotent narrowly-granted append RPC', () => {
    const sql = readEventLedgerMigration();

    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_append_connect_payout_event/i,
    );
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(
      /ON\s+CONFLICT\s*\(\s*stripe_event_id\s*\)\s+DO\s+NOTHING/i,
    );
    expect(sql).toMatch(/RETURN\s+COALESCE\s*\(\s*v_inserted\s*,\s*FALSE\s*\)/i);
  });

  test('keeps the ledger table and RPC out of public reach', () => {
    const sql = readEventLedgerMigration();

    expect(sql).toMatch(
      /ALTER\s+TABLE\s+public\.connect_payout_events\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.connect_payout_events\s+FROM\s+PUBLIC/i,
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.connect_payout_events\s+FROM\s+anon,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_append_connect_payout_event[\s\S]*FROM\s+PUBLIC/i,
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_append_connect_payout_event[\s\S]*FROM\s+anon,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_append_connect_payout_event[\s\S]*TO\s+service_role/i,
    );
  });

  test('explicitly revokes every direct service_role table privilege before the RPC grant', () => {
    const sql = readEventLedgerMigration();

    // Absence of a GRANT statement does not prove absence of direct
    // privileges: service_role could still hold table privileges granted by
    // a prior migration or environment default. The migration must revoke
    // them explicitly, after the PUBLIC revoke and before granting RPC
    // execution, so service_role keeps EXECUTE-only RPC access.
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.connect_payout_events\s+FROM\s+service_role\s*;/i,
    );

    const publicRevoke = sql.search(
      /REVOKE\s+ALL\s+ON\s+public\.connect_payout_events\s+FROM\s+PUBLIC/i,
    );
    const serviceRoleRevoke = sql.search(
      /REVOKE\s+ALL\s+ON\s+public\.connect_payout_events\s+FROM\s+service_role/i,
    );
    const rpcGrant = sql.search(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_append_connect_payout_event/i,
    );
    expect(publicRevoke).toBeGreaterThan(-1);
    expect(serviceRoleRevoke).toBeGreaterThan(publicRevoke);
    expect(rpcGrant).toBeGreaterThan(serviceRoleRevoke);
  });

  test('grants no direct table privileges through the migration', () => {
    const sql = readEventLedgerMigration();

    // The SECURITY DEFINER append RPC runs with its owner's privileges, so no
    // role needs direct table access: service_role only gets RPC EXECUTE.
    expect(sql).not.toMatch(
      /GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE)\s+ON\s+(TABLE\s+)?public\.connect_payout_events\b/i,
    );
    // Prove service_role specifically holds no direct table privilege: the
    // only service_role grant in this migration must be RPC EXECUTE.
    expect(sql).not.toMatch(
      /GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE)\s+(ON\s+TABLE\s+)?public\.connect_payout_events[\s\S]{0,80}TO\s+service_role/i,
    );
  });

  test('documents evidence semantics', () => {
    const sql = readEventLedgerMigration();

    expect(sql).toMatch(
      /COMMENT\s+ON\s+TABLE\s+public\.connect_payout_events\s+IS/i,
    );
    expect(sql).toMatch(
      /COMMENT\s+ON\s+COLUMN\s+public\.connect_payout_events\.stripe_event_id\s+IS/i,
    );
    expect(sql).toMatch(
      /COMMENT\s+ON\s+COLUMN\s+public\.connect_payout_events\.failure_balance_transaction\s+IS/i,
    );
  });
});
