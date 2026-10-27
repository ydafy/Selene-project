import { describe, expect, test } from 'bun:test';
import { isAuthorizedCronRequest, reportCronSecretMismatch } from './cron-auth';

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

describe('reportCronSecretMismatch', () => {
  type Report = Parameters<typeof reportCronSecretMismatch>[2];
  const recorder = () => {
    const calls: Parameters<Report>[] = [];
    const report: Report = async (...args) => {
      calls.push(args);
    };
    return { calls, report };
  };

  test('reports one tagged message for a wrong non-empty secret, never the header value', async () => {
    const { calls, report } = recorder();
    await reportCronSecretMismatch(
      request({ 'x-cron-secret': 'wrong-value-123' }),
      'auto-cancel-orders',
      report,
    );
    expect(calls).toEqual([
      [
        'auto-cancel-orders cron secret mismatch',
        {
          fingerprint: ['cron-secret-mismatch', 'auto-cancel-orders'],
          tags: { edge_function: 'auto-cancel-orders' },
        },
      ],
    ]);
    expect(JSON.stringify(calls)).not.toContain('wrong-value-123');
  });

  test('reports nothing when the header is missing or empty', async () => {
    const { calls, report } = recorder();
    await reportCronSecretMismatch(request(), 'auto-cancel-orders', report);
    await reportCronSecretMismatch(request({ 'x-cron-secret': '' }), 'auto-cancel-orders', report);
    expect(calls).toEqual([]);
  });

  test('never throws when the reporter rejects or throws', async () => {
    const headers = { 'x-cron-secret': 'wrong' };
    await reportCronSecretMismatch(request(headers), 'f', async () => {
      throw new Error('sentry down');
    });
    await reportCronSecretMismatch(request(headers), 'f', () => {
      throw new Error('sentry down');
    });
  });
});
