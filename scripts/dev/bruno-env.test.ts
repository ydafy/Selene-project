import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildBrunoEnv, brunoEnvVariableNames } from './bruno-env.ts';

const keys = {
  API_URL: 'http://127.0.0.1:22319',
  ANON_KEY: 'anon.jwt.value',
  SERVICE_ROLE_KEY: 'service.jwt.value',
};

describe('buildBrunoEnv', () => {
  test('writes the local stack variables and the cron secret', () => {
    const output = buildBrunoEnv(
      JSON.stringify({ env: keys, DB_URL: 'ignored' }),
      'SENTRY_DSN=x\nCRON_SECRET=cron-value\n',
    );
    expect(output).toBe(
      [
        'SUPABASE_URL=http://127.0.0.1:22319',
        'SUPABASE_ANON_KEY=anon.jwt.value',
        'SUPABASE_SERVICE_ROLE_KEY=service.jwt.value',
        'CRON_SECRET=cron-value',
        '',
      ].join('\n'),
    );
    expect(brunoEnvVariableNames(output)).toEqual([
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'CRON_SECRET',
    ]);
  });

  test('reads a flat JSON object and KEY="value" lines', () => {
    const flat = buildBrunoEnv(JSON.stringify(keys));
    const lines = buildBrunoEnv(
      Object.entries(keys)
        .map(([key, value]) => `${key}="${value}"`)
        .join('\r\n'),
    );
    expect(lines).toBe(flat);
    expect(flat).toContain('SUPABASE_ANON_KEY=anon.jwt.value\n');
  });

  test('omits CRON_SECRET when the functions env file is absent or lacks it', () => {
    expect(brunoEnvVariableNames(buildBrunoEnv(JSON.stringify(keys)))).toEqual([
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
    expect(
      buildBrunoEnv(JSON.stringify(keys), '# CRON_SECRET=x\nOTHER=1\n'),
    ).not.toContain('CRON_SECRET');
  });

  test('does not copy the retired fee reconciliation worker secret', () => {
    const output = buildBrunoEnv(
      JSON.stringify(keys),
      'STRIPE_FEE_RECONCILIATION_WORKER_SECRET="worker.jwt.value"\nCRON_SECRET=cron-value\n',
    );
    expect(brunoEnvVariableNames(output)).toEqual([
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'CRON_SECRET',
    ]);
    expect(output).not.toContain('STRIPE_FEE_RECONCILIATION_WORKER_SECRET');
  });

  test('reads a quoted CRON_SECRET and double-quotes values with #, quotes or spaces', () => {
    const output = buildBrunoEnv(
      JSON.stringify(keys),
      "CRON_SECRET='has space#and\"quote'\n",
    );
    expect(output).toContain('CRON_SECRET="has space#and\\"quote"\n');
  });

  test('writes a Stripe test key and the sandbox account after the worker secrets', () => {
    for (const key of ['sk_test_value', 'rk_test_value']) {
      const output = buildBrunoEnv(
        JSON.stringify(keys),
        `BRUNO_STRIPE_TEST_ACCOUNT_ID=acct_fixture\nSTRIPE_SECRET_KEY="${key}"\nCRON_SECRET=cron-value\n`,
      );
      expect(brunoEnvVariableNames(output)).toEqual([
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'CRON_SECRET',
        'STRIPE_SECRET_KEY',
        'BRUNO_STRIPE_TEST_ACCOUNT_ID',
      ]);
      expect(output).toContain(`STRIPE_SECRET_KEY=${key}\n`);
      expect(output).toContain('BRUNO_STRIPE_TEST_ACCOUNT_ID=acct_fixture\n');
    }
    const without = buildBrunoEnv(JSON.stringify(keys), 'CRON_SECRET=x\n');
    expect(without).not.toContain('STRIPE_SECRET_KEY');
    expect(without).not.toContain('BRUNO_STRIPE_TEST_ACCOUNT_ID');
  });

  test('refuses a Stripe key that is not a test key, without echoing it', () => {
    for (const key of [
      'sk_live_value',
      'rk_live_value',
      'pk_test_value',
      'x',
    ]) {
      let message = '';
      try {
        buildBrunoEnv(JSON.stringify(keys), `STRIPE_SECRET_KEY=${key}\n`);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe('STRIPE_TEST_KEY_REQUIRED');
    }
  });

  test('refuses a non-local API URL', () => {
    expect(() =>
      buildBrunoEnv(
        JSON.stringify({ ...keys, API_URL: 'https://abc.supabase.co' }),
      ),
    ).toThrow('LOCAL_API_URL_REQUIRED');
  });

  test('fails when the stack is not running or a key is missing', () => {
    expect(() => buildBrunoEnv('')).toThrow('LOCAL_STACK_NOT_RUNNING');
    expect(() =>
      buildBrunoEnv(JSON.stringify({ API_URL: keys.API_URL })),
    ).toThrow('MISSING_STATUS_KEYS: ANON_KEY, SERVICE_ROLE_KEY');
  });
});

test('package.json exposes the generator and the collection runner', () => {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  expect(pkg.scripts['bruno:env']).toBe('bun scripts/dev/bruno-env.ts');
  expect(pkg.scripts['api:test']).toContain('@usebruno/cli@4.2.1');
});
