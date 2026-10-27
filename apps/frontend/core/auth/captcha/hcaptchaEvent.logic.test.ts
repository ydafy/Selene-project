import { describe, expect, it } from 'bun:test';
import { interpretHcaptchaEvent } from './hcaptchaEvent.logic';

const TOKEN = 'P1_eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.example-token-value';

describe('interpretHcaptchaEvent', () => {
  it('returns the token of a successful event', () => {
    expect(
      interpretHcaptchaEvent({ success: true, nativeEvent: { data: TOKEN } }),
    ).toEqual({ kind: 'token', token: TOKEN });
  });

  it('keeps waiting while the challenge is open', () => {
    expect(
      interpretHcaptchaEvent({ success: true, nativeEvent: { data: 'open' } }),
    ).toEqual({ kind: 'pending' });
  });

  it('ignores events without data', () => {
    expect(interpretHcaptchaEvent({ nativeEvent: { data: '' } })).toEqual({
      kind: 'pending',
    });
  });

  it.each(['cancel', 'challenge-closed'])('maps %s to cancelled', (data) => {
    expect(
      interpretHcaptchaEvent({ success: false, nativeEvent: { data } }),
    ).toEqual({ kind: 'cancelled' });
  });

  it.each([
    'expired',
    'error',
    'network-error',
    'challenge-error',
    'rate-limited',
    'script-error',
  ])('maps %s to failed', (data) => {
    expect(
      interpretHcaptchaEvent({ success: false, nativeEvent: { data } }),
    ).toEqual({ kind: 'failed' });
  });
});
