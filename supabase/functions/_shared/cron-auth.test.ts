import { describe, expect, test } from 'bun:test';
import { isAuthorizedCronRequest } from './cron-auth';

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/functions/v1/auto-cancel-orders', {
    method: 'POST',
    headers,
  });

describe('isAuthorizedCronRequest', () => {
  test('accepts the matching secret', () => {
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': 's3cret' }), 's3cret')).toBe(true);
  });

  test('rejects a wrong secret of the same length', () => {
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': 's3cres' }), 's3cret')).toBe(false);
  });

  test('rejects a different length and a prefix of the secret', () => {
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': 's3cret-longer' }), 's3cret')).toBe(false);
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': 's3c' }), 's3cret')).toBe(false);
  });

  test('rejects a missing or empty header', () => {
    expect(isAuthorizedCronRequest(request(), 's3cret')).toBe(false);
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': '' }), 's3cret')).toBe(false);
  });

  test('fails closed when the expected secret is missing or empty', () => {
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': '' }), '')).toBe(false);
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': 'anything' }), '')).toBe(false);
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': 'undefined' }), undefined)).toBe(false);
    expect(isAuthorizedCronRequest(request(), undefined)).toBe(false);
  });

  test('does not read the Authorization header', () => {
    expect(
      isAuthorizedCronRequest(
        request({ Authorization: 'Bearer s3cret', apikey: 's3cret' }),
        's3cret',
      ),
    ).toBe(false);
  });

  test('matches the header name case-insensitively and rejects a duplicated header', () => {
    const withHeaders = (headers: [string, string][]) =>
      new Request('http://localhost/', { method: 'POST', headers });
    expect(isAuthorizedCronRequest(withHeaders([['X-Cron-Secret', 's3cret']]), 's3cret')).toBe(true);
    expect(
      isAuthorizedCronRequest(
        withHeaders([
          ['x-cron-secret', 's3cret'],
          ['x-cron-secret', 's3cret'],
        ]),
        's3cret',
      ),
    ).toBe(false);
  });

  test('compares non-ASCII secrets byte by byte', () => {
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': 'ñandú' }), 'ñandú')).toBe(true);
    expect(isAuthorizedCronRequest(request({ 'x-cron-secret': 'nandu' }), 'ñandú')).toBe(false);
  });
});
