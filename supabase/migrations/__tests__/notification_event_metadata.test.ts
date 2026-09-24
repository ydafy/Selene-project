import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = () => readFileSync(join(import.meta.dir, '..', '20260924000000_notification_event_metadata.sql'), 'utf8');

const kinds = [
  'order.payment_confirmed', 'shipment.cancelled', 'dispute.opened',
  'dispute.verdict', 'product.approved', 'product.approved_with_note',
  'product.rejected', 'return.seller_evidence_submitted', 'return.delivered',
];

describe('notification event metadata expansion', () => {
  it('wraps all DDL in one bounded transaction for whole-file Dashboard submission', () => {
    const text = sql();
    expect(text).toMatch(/^--[^]*?\nBEGIN;\s*SET LOCAL lock_timeout = '5s';\s*SET LOCAL statement_timeout = '60s';/);
    expect(text.trimEnd()).toMatch(/COMMIT;$/);
    expect(text.indexOf('BEGIN;')).toBeLessThan(text.indexOf('DO $$'));
    expect(text.indexOf('COMMIT;')).toBeGreaterThan(text.indexOf('CREATE UNIQUE INDEX'));
    expect(text).toMatch(/whole file as one transaction/i);
    expect(text).toMatch(/ROLLBACK.*inspect/i);
  });

  it('fails closed on all intended constraint and index name collisions', () => {
    const text = sql();
    for (const name of [
      'notifications_event_payload_object_chk',
      'notifications_event_identity_pair_chk',
      'notifications_source_event_key_nonempty_chk',
      'notifications_event_kind_catalogue_chk',
    ]) {
      expect(text).toMatch(new RegExp(`conname IN \\([\\s\\S]*?'${name}'[\\s\\S]*?\\)`));
    }
    expect(text).toContain("c.relname = 'notifications_source_event_key_user_id_uidx'");
    expect(text).toMatch(/Notification metadata names already exist; inspect schema/i);
  });

  it('requires privilege and workload inventory before deployment', () => {
    const text = sql();
    for (const item of ['table size', 'write rate', 'RLS/grants', 'client INSERT privilege', 'function ACL']) {
      expect(text).toContain(item);
    }
    expect(text).toMatch(/forge typed metadata/i);
    expect(text).toMatch(/do not enable privileged UI/i);
  });
  it('preflights the expected table and refuses pre-existing metadata', () => {
    const text = sql();
    expect(text).toMatch(/to_regclass\('public\.notifications'\)/i);
    for (const column of ['event_kind', 'source_event_key', 'event_payload']) {
      expect(text).toContain(`column_name = '${column}'`);
    }
    expect(text).toMatch(/RAISE EXCEPTION/);
  });

  it('adds nullable paired identity and object payload without changing legacy fields', () => {
    const text = sql();
    expect(text).toMatch(/ADD COLUMN event_kind text,/i);
    expect(text).toMatch(/ADD COLUMN source_event_key text,/i);
    expect(text).toMatch(/ADD COLUMN event_payload jsonb NOT NULL DEFAULT '\{\}'::jsonb/i);
    expect(text).toMatch(/jsonb_typeof\(event_payload\) = 'object'/);
    expect(text).toMatch(/\(event_kind IS NULL AND source_event_key IS NULL\) OR\s*\(event_kind IS NOT NULL AND source_event_key IS NOT NULL\)/);
    expect(text).toMatch(/length\(btrim\(source_event_key\)\) > 0/);
    for (const kind of kinds) expect(text).toContain(`'${kind}'`);
    expect(text).not.toMatch(/UPDATE public\.notifications|DROP |REVOKE /i);
  });

  it('deduplicates per recipient and calls out untrusted metadata until cutover', () => {
    const text = sql();
    expect(text).toMatch(/CREATE UNIQUE INDEX notifications_source_event_key_user_id_uidx\s+ON public\.notifications \(source_event_key, user_id\)\s+WHERE source_event_key IS NOT NULL/i);
    expect(text).toMatch(/NOT trustworthy/i);
    expect(text).toMatch(/RLS\/grants lockdown/i);
  });
});
