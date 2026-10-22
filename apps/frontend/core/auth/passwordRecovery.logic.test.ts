import { describe, expect, mock, test } from 'bun:test';

import { completePasswordRecovery } from './passwordRecovery.logic';

/**
 * Auth block 4 (S7, C3): the recovery code is single use. Once it is verified,
 * a failed password update is retried without verifying the code again.
 */
const authError = (code: string, status = 422) => ({
  name: 'AuthApiError',
  code,
  status,
  message: `raw ${code}`,
});

const makeAuth = (
  verifyError: unknown = null,
  updateErrors: unknown[] = [null],
) => {
  let updateCall = 0;
  return {
    verifyOtp: mock(async () => ({ error: verifyError })),
    updateUser: mock(async () => ({ error: updateErrors[updateCall++] ?? null })),
  };
};

const input = {
  email: '  buyer@selene.local ',
  code: '123456',
  newPassword: 'newpw1234',
};

describe('completePasswordRecovery', () => {
  test('verifies the recovery code, then updates the password', async () => {
    const auth = makeAuth();
    const result = await completePasswordRecovery(auth, {
      ...input,
      codeVerified: false,
    });

    expect(result).toEqual({ ok: true, codeVerified: true, messageKey: null });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'buyer@selene.local',
      token: '123456',
      type: 'recovery',
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'newpw1234' });
  });

  test('a rejected code never updates the password', async () => {
    const auth = makeAuth(authError('otp_expired', 403));
    const result = await completePasswordRecovery(auth, {
      ...input,
      codeVerified: false,
    });

    expect(result).toEqual({
      ok: false,
      codeVerified: false,
      messageKey: 'auth:errors.otpExpired',
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  test('a failed update keeps the code verified and shows the mapped key', async () => {
    const auth = makeAuth(null, [authError('same_password')]);
    const result = await completePasswordRecovery(auth, {
      ...input,
      codeVerified: false,
    });

    expect(result).toEqual({
      ok: false,
      codeVerified: true,
      messageKey: 'auth:errors.samePassword',
    });
  });

  test('a retry after a verified code only updates the password', async () => {
    const auth = makeAuth();
    const result = await completePasswordRecovery(auth, {
      ...input,
      codeVerified: true,
    });

    expect(result).toEqual({ ok: true, codeVerified: true, messageKey: null });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
  });

  test('a thrown network failure maps to the network key', async () => {
    const auth = {
      verifyOtp: mock(async () => {
        throw new TypeError('Network request failed');
      }),
      updateUser: mock(async () => ({ error: null })),
    };
    const result = await completePasswordRecovery(auth, {
      ...input,
      codeVerified: false,
    });

    expect(result).toEqual({
      ok: false,
      codeVerified: false,
      messageKey: 'auth:errors.network',
    });
  });
});
