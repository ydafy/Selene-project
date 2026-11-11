// source-text: supabase/config.toml is the deployed verify_jwt contract, and which functions check a cron secret is only visible in their source
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Cron jobs send no Supabase API key or JWT (#397): a cron-invoked function is authenticated by
// its own secret header, so the gateway must not verify a JWT. A function counts as cron-invoked
// when its non-test source checks `x-cron-secret` or a `*CRON_SECRET` value.
const FUNCTIONS_DIR = join(import.meta.dir, '..', '..');
const CONFIG = readFileSync(
  join(FUNCTIONS_DIR, '..', 'config.toml'),
  'utf8',
).replace(/\r\n/g, '\n');

const CRON_AUTH_MARKER = /isAuthorizedCronRequest\(|x-cron-secret|CRON_SECRET/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });

const CRON_FUNCTIONS = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .filter((name) =>
    sourceFiles(join(FUNCTIONS_DIR, name)).some((file) =>
      CRON_AUTH_MARKER.test(readFileSync(file, 'utf8')),
    ),
  )
  .sort();

const verifyJwtOf = (name: string): string | undefined =>
  new RegExp(
    `^\\[functions\\.${name}\\]\\n(?:#.*\\n)*verify_jwt = (true|false)$`,
    'm',
  ).exec(CONFIG)?.[1];

describe('cron functions run without gateway JWT verification', () => {
  it('finds every known cron function', () => {
    expect(CRON_FUNCTIONS).toEqual([
      'account-closure-cleanup',
      'auto-cancel-orders',
      'auto-cancel-preparing',
      'checkout-recovery-worker',
      'complete-delivered-shipments',
      'cron-watchdog',
      'dispatch-push',
      'reconcile-stripe-fees',
      'resume-pending-payouts',
      'track-shipments',
    ]);
  });

  for (const name of CRON_FUNCTIONS) {
    it(`${name} declares verify_jwt = false in supabase/config.toml`, () => {
      expect(verifyJwtOf(name)).toBe('false');
    });
  }
});
