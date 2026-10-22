import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  STRIPE_WEBHOOK_EVENTS,
  buildStripeListenArgs,
  parseLocalApiUrl,
} from './stripe-listen.ts';

describe('parseLocalApiUrl', () => {
  test('reads API_URL from the JSON printed by `supabase status --env` in stack mode', () => {
    const output = JSON.stringify({
      API_URL: 'http://127.0.0.1:22319',
      DB_URL: 'postgresql://postgres:postgres@127.0.0.1:23054/postgres',
    });
    expect(parseLocalApiUrl(output)).toBe('http://127.0.0.1:22319');
  });

  test('reads API_URL from `supabase status -o env` output', () => {
    const output = [
      'ANON_KEY="placeholder"',
      'API_URL="http://127.0.0.1:24321"',
      'DB_URL="postgresql://postgres:postgres@127.0.0.1:24322/postgres"',
    ].join('\n');
    expect(parseLocalApiUrl(output)).toBe('http://127.0.0.1:24321');
  });

  test('accepts unquoted values and CRLF line endings', () => {
    expect(parseLocalApiUrl('API_URL=http://127.0.0.1:20001\r\n')).toBe(
      'http://127.0.0.1:20001',
    );
  });

  test('refuses a non-local API URL so sandbox events never reach a remote project', () => {
    expect(() => parseLocalApiUrl('API_URL="https://abc.supabase.co"')).toThrow(
      'LOCAL_API_URL_REQUIRED',
    );
  });

  test('fails when the local stack is not running', () => {
    expect(() => parseLocalApiUrl('')).toThrow('LOCAL_STACK_NOT_RUNNING');
  });
});

describe('buildStripeListenArgs', () => {
  test('forwards platform and Connect events to the local stripe-webhooks', () => {
    const target = 'http://127.0.0.1:24321/functions/v1/stripe-webhooks';
    expect(buildStripeListenArgs('http://127.0.0.1:24321/')).toEqual([
      'listen',
      '--events',
      STRIPE_WEBHOOK_EVENTS.join(','),
      '--forward-to',
      target,
      '--forward-connect-to',
      target,
    ]);
  });

  test('keeps the event list handled by stripe-webhooks', () => {
    expect(STRIPE_WEBHOOK_EVENTS).toEqual([
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'payment_intent.canceled',
      'setup_intent.succeeded',
      'refund.updated',
      'refund.failed',
      'account.updated',
      'account.external_account.created',
      'account.external_account.updated',
      'account.external_account.deleted',
      'payout.created',
      'payout.updated',
      'payout.paid',
      'payout.failed',
      'payout.canceled',
    ]);
  });
});

test('package.json runs the script instead of a fixed port', () => {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  expect(pkg.scripts['stripe:listen']).toBe('bun scripts/stripe-listen.ts');
});
