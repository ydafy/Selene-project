import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { verifyStripeWebhookSignature } from './signature.ts';

type FakeEvent = { id: string };

const constructWith =
  (validSecret: string, calls: string[]) =>
  async (_rawBody: string, _signature: string, secret: string) => {
    calls.push(secret);
    if (secret !== validSecret) throw new Error('No signatures found');
    return { id: 'evt_test' } as FakeEvent;
  };

describe('verifyStripeWebhookSignature', () => {
  it('accepts an event signed with the platform secret', async () => {
    const calls: string[] = [];
    const result = await verifyStripeWebhookSignature({
      rawBody: '{}',
      signature: 't=1,v1=abc',
      secrets: ['whsec_platform', 'whsec_connect'],
      construct: constructWith('whsec_platform', calls),
    });
    expect(result).toEqual({ ok: true, event: { id: 'evt_test' } });
    expect(calls).toEqual(['whsec_platform']);
  });

  it('falls back to the Connect secret', async () => {
    const calls: string[] = [];
    const result = await verifyStripeWebhookSignature({
      rawBody: '{}',
      signature: 't=1,v1=abc',
      secrets: ['whsec_platform', 'whsec_connect'],
      construct: constructWith('whsec_connect', calls),
    });
    expect(result).toEqual({ ok: true, event: { id: 'evt_test' } });
    expect(calls).toEqual(['whsec_platform', 'whsec_connect']);
  });

  it('rejects a signature that matches no configured secret', async () => {
    const calls: string[] = [];
    const result = await verifyStripeWebhookSignature({
      rawBody: '{}',
      signature: 't=1,v1=forged',
      secrets: ['whsec_platform', 'whsec_connect'],
      construct: constructWith('whsec_other', calls),
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
    expect(calls).toEqual(['whsec_platform', 'whsec_connect']);
  });

  it('never verifies against an empty secret', async () => {
    const calls: string[] = [];
    const result = await verifyStripeWebhookSignature({
      rawBody: '{}',
      signature: 't=1,v1=abc',
      secrets: ['', 'whsec_connect'],
      construct: constructWith('', calls),
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
    expect(calls).toEqual(['whsec_connect']);
  });

  it('rejects when verification throws a non-Error value', async () => {
    const result = await verifyStripeWebhookSignature({
      rawBody: '{}',
      signature: 't=1,v1=x',
      secrets: ['whsec_a'],
      construct: async () => {
        throw 'boom';
      },
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('fails closed when no secret is configured', async () => {
    const calls: string[] = [];
    const result = await verifyStripeWebhookSignature({
      rawBody: '{}',
      signature: 't=1,v1=abc',
      secrets: ['', ''],
      construct: constructWith('', calls),
    });
    expect(result).toEqual({ ok: false, reason: 'missing_secret' });
    expect(calls).toEqual([]);
  });
});

describe('stripe-webhooks entrypoint signature wiring', () => {
  const source = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('rejects unverified requests with 400 before any database write', () => {
    const verify = source.indexOf('verifyStripeWebhookSignature({');
    const reject = source.indexOf("'Invalid signature', { status: 400 }");
    const firstClient = source.indexOf('createClient<Database>(');
    const dlq = source.indexOf("from('webhook_dlq')");
    expect(verify).toBeGreaterThan(-1);
    expect(reject).toBeGreaterThan(verify);
    expect(reject).toBeLessThan(firstClient);
    expect(reject).toBeLessThan(dlq);
  });

  it('no longer verifies signatures inline', () => {
    expect(source).not.toContain('constructEventAsync(\n        rawBody');
    expect(source.match(/constructEventAsync/g)).toHaveLength(1);
  });
});
