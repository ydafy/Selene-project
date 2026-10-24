import { describe, expect, it } from 'bun:test';
import {
  CAPTCHA_CANCELLED_CODE,
  CaptchaError,
} from './captcha/captcha.logic';
import {
  reauthSignInWithPassword,
  resendSignupCode,
  sendRecoveryCode,
  signInWithPasswordCaptcha,
  signUpWithCaptcha,
  type CaptchaAuth,
} from './captchaAuth.logic';

const makeAuth = () => {
  const calls: { method: string; params: unknown[] }[] = [];
  const record =
    (method: string, result: unknown = { data: {}, error: null }) =>
    async (...params: unknown[]) => {
      calls.push({ method, params });
      return result;
    };
  const auth = {
    signUp: record('signUp'),
    signInWithPassword: record('signInWithPassword', {
      data: { user: { id: 'u1' } },
      error: null,
    }),
    resend: record('resend'),
    resetPasswordForEmail: record('resetPasswordForEmail'),
  } as unknown as CaptchaAuth;
  return { auth, calls };
};

const withToken = async () => 'tok';
const noToken = async () => undefined;
const cancelled = async (): Promise<string> => {
  throw new CaptchaError(CAPTCHA_CANCELLED_CODE);
};

describe('signUpWithCaptcha', () => {
  const input = { email: 'a@b.mx', password: 'pw', username: 'ana' };

  it('passes the token and keeps the username metadata', async () => {
    const { auth, calls } = makeAuth();
    await signUpWithCaptcha(auth, withToken, input);
    expect(calls[0].params[0]).toEqual({
      email: 'a@b.mx',
      password: 'pw',
      options: { data: { username: 'ana' }, captchaToken: 'tok' },
    });
  });

  it('sends no token when captcha is not configured', async () => {
    const { auth, calls } = makeAuth();
    await signUpWithCaptcha(auth, noToken, input);
    expect(
      (calls[0].params[0] as { options: { captchaToken?: string } }).options
        .captchaToken,
    ).toBeUndefined();
  });

  it('does not call Supabase when the challenge fails', async () => {
    const { auth, calls } = makeAuth();
    await expect(signUpWithCaptcha(auth, cancelled, input)).rejects.toBeInstanceOf(
      CaptchaError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('signInWithPasswordCaptcha', () => {
  it('passes the token', async () => {
    const { auth, calls } = makeAuth();
    await signInWithPasswordCaptcha(auth, withToken, 'a@b.mx', 'pw');
    expect(calls[0].params[0]).toEqual({
      email: 'a@b.mx',
      password: 'pw',
      options: { captchaToken: 'tok' },
    });
  });

  it('does not call Supabase when the challenge fails', async () => {
    const { auth, calls } = makeAuth();
    await expect(
      signInWithPasswordCaptcha(auth, cancelled, 'a@b.mx', 'pw'),
    ).rejects.toBeInstanceOf(CaptchaError);
    expect(calls).toHaveLength(0);
  });
});

describe('resendSignupCode', () => {
  it('passes the token', async () => {
    const { auth, calls } = makeAuth();
    await resendSignupCode(auth, withToken, 'a@b.mx');
    expect(calls[0].params[0]).toEqual({
      type: 'signup',
      email: 'a@b.mx',
      options: { captchaToken: 'tok' },
    });
  });

  it('does not call Supabase when the challenge fails', async () => {
    const { auth, calls } = makeAuth();
    await expect(resendSignupCode(auth, cancelled, 'a@b.mx')).rejects.toBeInstanceOf(
      CaptchaError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('sendRecoveryCode', () => {
  it('passes the token', async () => {
    const { auth, calls } = makeAuth();
    await sendRecoveryCode(auth, withToken, 'a@b.mx');
    expect(calls[0].params).toEqual(['a@b.mx', { captchaToken: 'tok' }]);
  });

  it('does not call Supabase when the challenge fails', async () => {
    const { auth, calls } = makeAuth();
    await expect(sendRecoveryCode(auth, cancelled, 'a@b.mx')).rejects.toBeInstanceOf(
      CaptchaError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('reauthSignInWithPassword', () => {
  it('passes the token and returns the user id', async () => {
    const { auth, calls } = makeAuth();
    const outcome = await reauthSignInWithPassword(auth, withToken, 'a@b.mx', 'pw');
    expect(outcome).toEqual({ userId: 'u1', error: null });
    expect(
      (calls[0].params[0] as { options: { captchaToken?: string } }).options
        .captchaToken,
    ).toBe('tok');
  });

  it('returns the captcha error without calling Supabase when the challenge fails', async () => {
    const { auth, calls } = makeAuth();
    const outcome = await reauthSignInWithPassword(auth, cancelled, 'a@b.mx', 'pw');
    expect(outcome.userId).toBeNull();
    expect((outcome.error as CaptchaError).code).toBe(CAPTCHA_CANCELLED_CODE);
    expect(calls).toHaveLength(0);
  });
});
