import { describe, expect, it } from 'bun:test';

import {
  CAPTCHA_CANCELLED_CODE,
  CAPTCHA_FAILED_CODE,
  CaptchaError,
  createCaptchaGetter,
  toCaptchaError,
  type CaptchaProviderHandle,
} from './captcha.logic';

const provider = (
  request: () => Promise<string>,
  configured = true,
): CaptchaProviderHandle => ({ configured, request });

describe('createCaptchaGetter', () => {
  it('resolves undefined without a challenge when not configured', async () => {
    let calls = 0;
    const getToken = createCaptchaGetter(() =>
      provider(async () => {
        calls += 1;
        return 'token';
      }, false),
    );
    expect(await getToken()).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('resolves the token of the challenge', async () => {
    const getToken = createCaptchaGetter(() => provider(async () => 'tok'));
    expect(await getToken()).toBe('tok');
  });

  it('fails closed when no provider is mounted', async () => {
    const getToken = createCaptchaGetter(() => null);
    await expect(getToken()).rejects.toMatchObject({ code: CAPTCHA_FAILED_CODE });
  });

  it('propagates a cancelled challenge', async () => {
    const getToken = createCaptchaGetter(() =>
      provider(async () => {
        throw new CaptchaError(CAPTCHA_CANCELLED_CODE);
      }),
    );
    await expect(getToken()).rejects.toMatchObject({ code: CAPTCHA_CANCELLED_CODE });
  });

  it('fails with captcha_failed when the widget stays silent', async () => {
    const getToken = createCaptchaGetter(
      () => provider(() => new Promise<string>(() => {})),
      10,
    );
    await expect(getToken()).rejects.toMatchObject({ code: CAPTCHA_FAILED_CODE });
  });
});

describe('toCaptchaError', () => {
  it('maps a closed challenge to cancelled and anything else to failed', () => {
    expect(toCaptchaError('challenge-closed').code).toBe(CAPTCHA_CANCELLED_CODE);
    expect(toCaptchaError('challenge-expired').code).toBe(CAPTCHA_FAILED_CODE);
    expect(toCaptchaError(new Error('x')).code).toBe(CAPTCHA_FAILED_CODE);
  });

  it('keeps an existing CaptchaError', () => {
    const error = new CaptchaError(CAPTCHA_CANCELLED_CODE);
    expect(toCaptchaError(error)).toBe(error);
  });
});
