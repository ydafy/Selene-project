import { describe, expect, it } from 'bun:test';

import {
  CAPTCHA_CANCELLED_CODE,
  CAPTCHA_FAILED_CODE,
  CaptchaError,
} from './captcha.logic';
import {
  loginErrorMessage,
  signInWithPasswordCaptcha,
  type CaptchaAuth,
} from './captchaAuth.logic';

const makeAuth = () => {
  const calls: unknown[] = [];
  const auth = {
    signInWithPassword: async (credentials: unknown) => {
      calls.push(credentials);
      return { data: { user: null }, error: null };
    },
  } as unknown as CaptchaAuth;
  return { auth, calls };
};

describe('signInWithPasswordCaptcha', () => {
  it('sends the token as options.captchaToken', async () => {
    const { auth, calls } = makeAuth();
    await signInWithPasswordCaptcha(auth, async () => 'tok', 'a@b.mx', 'pw');
    expect(calls).toEqual([
      { email: 'a@b.mx', password: 'pw', options: { captchaToken: 'tok' } },
    ]);
  });

  it('sends no token when CAPTCHA is not configured', async () => {
    const { auth, calls } = makeAuth();
    await signInWithPasswordCaptcha(auth, async () => undefined, 'a@b.mx', 'pw');
    expect(calls).toEqual([
      { email: 'a@b.mx', password: 'pw', options: { captchaToken: undefined } },
    ]);
  });

  it('does not call Supabase when the challenge fails', async () => {
    const { auth, calls } = makeAuth();
    const getToken = async () => {
      throw new CaptchaError(CAPTCHA_CANCELLED_CODE);
    };
    await expect(
      signInWithPasswordCaptcha(auth, getToken, 'a@b.mx', 'pw'),
    ).rejects.toMatchObject({ code: CAPTCHA_CANCELLED_CODE });
    expect(calls).toEqual([]);
  });
});

describe('loginErrorMessage', () => {
  it('maps captcha codes, local or from the server, to Spanish', () => {
    const failed = loginErrorMessage(new CaptchaError(CAPTCHA_FAILED_CODE));
    expect(failed).toContain('verificación');
    expect(loginErrorMessage(Object.assign(new Error('x'), { code: 'captcha_failed' }))).toBe(failed);
    expect(loginErrorMessage(new CaptchaError(CAPTCHA_CANCELLED_CODE))).not.toBe(failed);
  });

  it('keeps other messages and the generic fallback', () => {
    expect(loginErrorMessage(new Error('Invalid login credentials'))).toBe('Invalid login credentials');
    expect(loginErrorMessage('boom')).toBe('Error inesperado al iniciar sesión.');
  });
});
