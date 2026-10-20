import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrations = join(import.meta.dir, '..', 'archive');
const readMigration = () => {
  const filename = readdirSync(migrations).find((name) =>
    name.endsWith('_paginate_admin_payout_queue.sql'),
  );
  expect(filename).toBeDefined();
  return readFileSync(join(migrations, filename!), 'utf8').replace(/\r\n/g, '\n');
};

describe('admin payout group pagination (SQL structural guards, not DB execution)', () => {
  test('validates scope and page before reading, and never mutates financial data', () => {
    const sql = readMigration();
    expect(sql).toContain("p_bucket NOT IN ('ready', 'processing', 'action-required', 'history')");
    expect(sql).toContain("p_scope NOT IN ('page', 'selection')");
    expect(sql).toContain('p_page IS NULL OR p_page < 0');
    expect(sql).toContain("p_scope = 'selection' AND p_bucket NOT IN ('ready', 'action-required')");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER TABLE)\b/i);
    expect(sql).toContain('RETURNS JSONB');
    expect(sql).toContain('STABLE');
  });

  test('groups full seller or run identities before choosing page IDs', () => {
    const sql = readMigration();
    expect(sql).toContain("THEN 'seller:' || q.seller_id::TEXT");
    expect(sql).toContain("ELSE 'run:' || q.payout_run_id::TEXT");
    expect(sql).toContain('GROUP BY queue_group_id');
    expect(sql).toContain('FROM public.admin_connect_payout_release_view q');
    expect(sql).toContain('JOIN chosen_groups g ON g.queue_group_id = r.queue_group_id');
    expect(sql).toContain('jsonb_agg(r.row_data ORDER BY g.position, r.completed_at, r.shipment_id)');
    expect(sql).not.toMatch(/\bLIMIT\b|\bOFFSET\b/i);
  });

  test('select-all is an explicit complete selectable set without a page restriction', () => {
    const sql = readMigration();
    expect(sql).toContain("(p_scope = 'selection' AND g.selectable)");
    expect(sql).toContain("OR (p_scope = 'page' AND g.position > b.page * 20");
    expect(sql).toContain('AND g.position <= (b.page + 1) * 20)');
    expect(sql).toContain("'selectionComplete', p_scope = 'selection'");
    expect(sql).toContain("BOOL_AND(COALESCE(payout_run_status = 'failed', FALSE) AND COALESCE(is_retryable, FALSE))");
    expect(sql).toContain('BOOL_OR(is_eligible IS TRUE AND release_amount_cents > 0)');
  });

  test('keeps query-scoped counts in group units, literal search, and History chronology', () => {
    const sql = readMigration();
    expect(sql).toContain("strpos(lower(COALESCE(q.seller_name, '')), lower(v_search)) > 0");
    expect(sql).toContain("COUNT(*) FILTER (WHERE bucket = 'ready')");
    expect(sql).toContain("COUNT(*) FILTER (WHERE bucket = 'action-required')");
    expect(sql).toContain("CASE WHEN p_bucket = 'history' THEN paid_at END DESC NULLS LAST");
    expect(sql).toContain("CASE WHEN p_bucket = 'history' THEN queue_group_id END DESC");
    expect(sql).toContain('MAX(payout_run_paid_at) AS paid_at');
    expect(sql).toContain('LEAST(p_page::BIGINT, GREATEST((COUNT(*) + 19) / 20 - 1, 0)) AS page');
  });

  test('only the server service role may execute the security-invoker read RPC', () => {
    const sql = readMigration();
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('SET search_path = pg_catalog, public');
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_get_admin_payout_queue\(TEXT, TEXT, INTEGER, TEXT\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_admin_payout_queue\(TEXT, TEXT, INTEGER, TEXT\)\s+TO service_role;/);
    expect(sql.trim()).toMatch(/COMMIT;$/);
    expect(sql).toContain('BEGIN;');
  });

  test('canonical read RPC and incremental migration are identical', () => {
    const canonical = readFileSync(join(migrations, '../../queries/payments/admin_payout_queue_pagination.sql'), 'utf8').replace(/\r\n/g, '\n');
    expect(readMigration()).toBe(canonical);
  });
});
