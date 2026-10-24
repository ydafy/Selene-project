import { describe, expect, it } from 'bun:test';
import {
  CAPTCHA_CANCELLED_CODE,
  CAPTCHA_FAILED_CODE,
  CaptchaError,
  createCaptchaGetter,
  type CaptchaProviderHandle,
} from './captcha.logic';

const provider = (
  over: Partial<CaptchaProviderHandle> = {},
): CaptchaProviderHandle => ({
  configured: true,
  request: async () => 'token-1',
  ...over,
});

describe('createCaptchaGetter', () => {
  it('resolves undefined without opening a challenge when not configured', async () => {
    let requests = 0;
    const getToken = createCaptchaGetter(() =>
      provider({
        configured: false,
        request: async () => {
          requests += 1;
          return 'never';
        },
      }),
    );
    expect(await getToken()).toBeUndefined();
    expect(requests).toBe(0);
  });

  it('resolves the token of a solved challenge', async () => {
    const getToken = createCaptchaGetter(() => provider());
    expect(await getToken()).toBe('token-1');
  });

  it('requests a fresh challenge on every call', async () => {
    let n = 0;
    const getToken = createCaptchaGetter(() =>
      provider({ request: async () => `token-${++n}` }),
    );
    expect(await getToken()).toBe('token-1');
    expect(await getToken()).toBe('token-2');
  });

  it('rejects with the captcha error when the user cancels', async () => {
    const getToken = createCaptchaGetter(() =>
      provider({
        request: async () => {
          throw new CaptchaError(CAPTCHA_CANCELLED_CODE);
        },
      }),
    );
    const error = await getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptchaError);
    expect((error as CaptchaError).code).toBe(CAPTCHA_CANCELLED_CODE);
  });

  it('fails closed when the provider is not mounted', async () => {
    const getToken = createCaptchaGetter(() => null);
    const error = await getToken().catch((e: unknown) => e);
    expect((error as CaptchaError).code).toBe(CAPTCHA_FAILED_CODE);
  });
});
