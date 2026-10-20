import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(
  import.meta.dir,
  '..',
  'archive',
  '20261020000000_drop_embedded_secret_objects.sql',
);
const sql = readFileSync(file, 'utf8').replace(/\s+/g, ' ');

describe('drop objects with embedded secrets (SQL structural only)', () => {
  test('runs in one transaction', () => {
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
  });

  test('removes the dead order webhook trigger that carried a service_role JWT', () => {
    expect(sql).toContain(
      'DROP TRIGGER IF EXISTS tr_webhook_order_completed ON public.orders;',
    );
  });

  test('removes the unused Stripe foreign data wrapper and its plaintext key', () => {
    for (const table of ['customers', 'payment_intents', 'charges']) {
      expect(sql).toContain(`DROP FOREIGN TABLE IF EXISTS stripe.${table};`);
    }
    expect(sql).toContain('DROP SERVER IF EXISTS stripe_server;');
    expect(sql).toContain(
      'DROP FOREIGN DATA WRAPPER IF EXISTS stripe_wrapper;',
    );
    expect(sql).toContain('DROP SCHEMA IF EXISTS stripe;');
  });

  test('never cascades and never carries a secret', () => {
    expect(sql).not.toMatch(/CASCADE/i);
    expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sk_(live|test)_|whsec_/);
  });

  test('leaves data and other objects untouched', () => {
    expect(sql).not.toMatch(/DELETE |UPDATE |INSERT |TRUNCATE |DROP TABLE /i);
  });
});
