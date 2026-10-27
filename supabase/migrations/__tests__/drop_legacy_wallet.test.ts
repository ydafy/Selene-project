import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for remove-legacy-wallet T6: one migration drops the wallet
 * objects and nothing in the repository's SQL still points at them. These tests
 * read SQL text; `supabase db reset` proves the migration runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const REPO_ROOT = join(MIGRATIONS_DIR, '..', '..');
const QUERIES_DIR = join(REPO_ROOT, 'supabase', 'queries');

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('_drop_legacy_wallet.sql'));
const migrationName = migrationFiles[0] ?? '';
const migration = migrationName
  ? readFileSync(join(MIGRATIONS_DIR, migrationName), 'utf8').replace(/\r\n/g, '\n')
  : '';
const code = migration.replace(/^\s*--.*$/gm, '');

const DROPPED_NAMES =
  /\bwallets\b|wallet_transactions|wallet_transaction_type|payout_requests|seller_bank_accounts|mexico_banks|fn_request_payout|fn_save_bank_account|fn_cron_release_shipment_funds|admin_payments_overview|connect_enabled/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === '__tests__') return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

describe('drop_legacy_wallet migration', () => {
  test('exists exactly once and runs in one transaction', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.trimEnd()).toEndWith('COMMIT;');
  });

  test('drops the retired functions by exact signature', () => {
    expect(code).toContain('DROP FUNCTION public.fn_request_payout(numeric, uuid);');
    expect(code).toContain('DROP FUNCTION public.fn_save_bank_account(text, text);');
    expect(code).toContain('DROP FUNCTION internal.fn_save_bank_account(text, text);');
    expect(code).toContain('DROP FUNCTION public.fn_cron_release_shipment_funds();');
  });

  test('keeps fn_release_shipment_funds', () => {
    expect(code).not.toMatch(/DROP FUNCTION public\.fn_release_shipment_funds/);
  });

  test('drops admin_payments_overview and recreates admin_user_directory_view without balances', () => {
    expect(code).toContain('DROP VIEW public.admin_payments_overview;');
    expect(code).toContain('DROP VIEW public.admin_user_directory_view;');
    const create = code.match(/CREATE VIEW public\.admin_user_directory_view[\s\S]*?;/)?.[0] ?? '';
    expect(create).toContain('security_invoker = true');
    expect(create).toContain('p.created_at');
    expect(create).not.toMatch(/wallets|available_balance|pending_balance/);
    expect(code.indexOf('DROP VIEW public.admin_user_directory_view;')).toBeLessThan(
      code.indexOf('DROP TABLE public.wallets'),
    );
  });

  test('drops the tables in dependency order, the enum and connect_enabled, without CASCADE', () => {
    const order = [
      'DROP TABLE public.payout_requests;',
      'DROP TABLE public.wallet_transactions;',
      'DROP TABLE public.wallets;',
      'DROP TABLE public.seller_bank_accounts;',
      'DROP TABLE public.mexico_banks;',
      'DROP TYPE public.wallet_transaction_type;',
      'ALTER TABLE public.system_settings DROP COLUMN connect_enabled;',
    ];
    let last = -1;
    for (const statement of order) {
      const at = code.indexOf(statement);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
    expect(code).not.toMatch(/CASCADE/i);
  });

  test('no canonical query file references a dropped object', () => {
    const offenders = walk(QUERIES_DIR)
      .filter((f) => /\.(sql|json)$/.test(f))
      .filter((f) => DROPPED_NAMES.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(REPO_ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  test('no later migration references a dropped object', () => {
    const later = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f > migrationName)
      .filter((f) => DROPPED_NAMES.test(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')));
    expect(later).toEqual([]);
  });

  test('the release-funds Edge Function and its config entry are gone', () => {
    expect(existsSync(join(REPO_ROOT, 'supabase', 'functions', 'release-funds'))).toBe(false);
    expect(readFileSync(join(REPO_ROOT, 'supabase', 'config.toml'), 'utf8')).not.toContain('release-funds');
  });
});
