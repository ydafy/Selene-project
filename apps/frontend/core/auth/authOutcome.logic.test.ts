import { describe, expect, it } from 'bun:test';

import {
  classifyLoginError,
  classifySignUpResult,
  recoverUnconfirmedLogin,
} from './authOutcome.logic';

describe('classifyLoginError', () => {
  it('detects an unconfirmed email by the error code, not the message', () => {
    expect(
      classifyLoginError({ code: 'email_not_confirmed', message: 'Correo sin confirmar' }),
    ).toBe('email_not_confirmed');
  });

  it('does not treat the English message alone as unconfirmed', () => {
    expect(classifyLoginError({ message: 'Email not confirmed' })).toBe('other');
  });

  it('keeps other errors as other', () => {
    expect(
      classifyLoginError({ code: 'invalid_credentials', message: 'Invalid login credentials' }),
    ).toBe('other');
  });
});

describe('recoverUnconfirmedLogin', () => {
  it('resends the signup code and opens verification with the email', async () => {
    const calls: string[] = [];
    await recoverUnconfirmedLogin('a@b.mx', {
      resend: async (email) => {
        calls.push(`resend:${email}`);
        return { success: true };
      },
      openVerification: (email) => calls.push(`open:${email}`),
    });
    expect(calls).toEqual(['resend:a@b.mx', 'open:a@b.mx']);
  });

  it('still opens verification when the resend fails', async () => {
    const opened: string[] = [];
    await recoverUnconfirmedLogin('a@b.mx', {
      resend: async () => ({ success: false }),
      openVerification: (email) => opened.push(email),
    });
    expect(opened).toEqual(['a@b.mx']);
  });

  it('still opens verification when the resend throws', async () => {
    const opened: string[] = [];
    await recoverUnconfirmedLogin('a@b.mx', {
      resend: async () => {
        throw new Error('network');
      },
      openVerification: (email) => opened.push(email),
    });
    expect(opened).toEqual(['a@b.mx']);
  });
});

describe('classifySignUpResult', () => {
  it('flags an existing account: user with empty identities and no session', () => {
    expect(
      classifySignUpResult({ user: { identities: [] }, session: null }),
    ).toBe('account_exists');
  });

  it('sends a new signup to verification', () => {
    expect(
      classifySignUpResult({ user: { identities: [{}] }, session: null }),
    ).toBe('verify');
  });

  it('does not flag a user whose identities are not reported', () => {
    expect(classifySignUpResult({ user: {}, session: null })).toBe('verify');
  });

  it('keeps the current behavior when the signup returns a session', () => {
    expect(
      classifySignUpResult({ user: { identities: [] }, session: {} }),
    ).toBe('verify');
  });

  it('returns none without user or session', () => {
    expect(classifySignUpResult({ user: null, session: null })).toBe('none');
  });
});
