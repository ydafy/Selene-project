import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  STRIPE_WEBHOOK_EVENTS,
  buildStripeListenArgs,
  parseLocalApiUrl,
  readGoLiveWebhookEvents,
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
      'PUBLISHABLE_KEY="sb_publishable_placeholder"',
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
    readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  expect(pkg.scripts['stripe:listen']).toBe('bun scripts/dev/stripe-listen.ts');
});

function describeDrift(markdown: string): string | undefined {
  const documented = new Set(readGoLiveWebhookEvents(markdown));
  const forwarded = new Set<string>(STRIPE_WEBHOOK_EVENTS);
  const notInDoc = [...forwarded].filter((event) => !documented.has(event));
  const notInListen = [...documented].filter((event) => !forwarded.has(event));
  if (notInDoc.length === 0 && notInListen.length === 0) return undefined;
  return `docs/go-live.md and STRIPE_WEBHOOK_EVENTS differ. Not in docs/go-live.md: ${notInDoc.join(', ') || 'none'}. Not in scripts/dev/stripe-listen.ts: ${notInListen.join(', ') || 'none'}.`;
}

describe('docs/go-live.md webhook events', () => {
  const platform = STRIPE_WEBHOOK_EVENTS.slice(0, 6);
  const connect = STRIPE_WEBHOOK_EVENTS.slice(6);
  const toDoc = (first: readonly string[], second: readonly string[]) =>
    [
      `- Platform events: ${first.map((e) => `\`${e}\``).join(', ')}.`,
      `  - Connect events: ${second.map((e) => `\`${e}\``).join(', ')}.`,
    ].join('\n');

  test('reads the platform and Connect lists', () => {
    expect(readGoLiveWebhookEvents(toDoc(platform, connect))).toEqual([
      ...STRIPE_WEBHOOK_EVENTS,
    ]);
  });

  test('fails loudly when a list is missing or empty, so a rewrite cannot pass silently', () => {
    expect(() => readGoLiveWebhookEvents('nothing here')).toThrow(
      'GO_LIVE_EVENTS_NOT_FOUND',
    );
    expect(() =>
      readGoLiveWebhookEvents(
        '- Platform events: none.\n- Connect events: `a.b`.',
      ),
    ).toThrow('GO_LIVE_EVENTS_NOT_FOUND');
  });

  test('names an event missing from the doc and one missing from the script', () => {
    const message = describeDrift(
      toDoc(platform.slice(1), [...connect, 'extra.event']),
    );
    expect(message).toContain(`Not in docs/go-live.md: ${platform[0]}.`);
    expect(message).toContain(
      'Not in scripts/dev/stripe-listen.ts: extra.event.',
    );
  });

  test('the list in docs/go-live.md equals STRIPE_WEBHOOK_EVENTS', () => {
    const markdown = readFileSync(
      join(import.meta.dir, '..', '..', 'docs', 'go-live.md'),
      'utf8',
    );
    expect(describeDrift(markdown)).toBeUndefined();
  });
});
