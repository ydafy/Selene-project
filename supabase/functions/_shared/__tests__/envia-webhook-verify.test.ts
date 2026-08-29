import { describe, expect, it } from 'bun:test';
import { constantTimeEqual, verifyEnviaWebhook } from '../envia-webhook-verify.ts';

const secret = 'test-webhook-secret';
const event = 'tracking.simple';
const rawBody = '{"type":"tracking.simple","data":{"status":"Delivered"}}';
const now = Date.parse('2026-08-28T00:00:00.000Z');
const sign = async (timestamp: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${event}.${rawBody}`));
  return `v1=${Buffer.from(signature).toString('hex')}`;
};
const headersFor = async (timestamp: string): Promise<Headers> => new Headers({ 'X-Webhook-Event': event, 'X-Webhook-Timestamp': timestamp, 'X-Webhook-Signature': await sign(timestamp) });

describe('constantTimeEqual', () => {
  it('accepts an exact value and rejects same-length and different-length mismatches', () => {
    expect(constantTimeEqual('a1b2', 'a1b2')).toBe(true); expect(constantTimeEqual('a1b2', 'a1b3')).toBe(false); expect(constantTimeEqual('a1b2', 'a1b2c3')).toBe(false);
  });
});
describe('verifyEnviaWebhook', () => {
  it('accepts a correctly signed webhook at the 13-digit replay boundary', async () => await expect(verifyEnviaWebhook({ headers: await headersFor(String(now - 300_000)), rawBody, secret, now })).resolves.toBe(true));
  it('accepts documented 10-digit timestamps and rejects malformed, missing, invalid, and stale signatures', async () => {
    await expect(verifyEnviaWebhook({ headers: await headersFor(String(Math.floor(now / 1_000))), rawBody, secret, now })).resolves.toBe(true);
    const invalidSignatureHeaders = await headersFor(String(now)); invalidSignatureHeaders.set('X-Webhook-Signature', 'v1=00');
    await expect(verifyEnviaWebhook({ headers: invalidSignatureHeaders, rawBody, secret, now })).resolves.toBe(false);
    await expect(verifyEnviaWebhook({ headers: new Headers(), rawBody, secret, now })).resolves.toBe(false);
    await expect(verifyEnviaWebhook({ headers: await headersFor('not-a-timestamp'), rawBody, secret, now })).resolves.toBe(false);
    await expect(verifyEnviaWebhook({ headers: await headersFor(String(now - 300_001)), rawBody, secret, now })).resolves.toBe(false);
  });
});
