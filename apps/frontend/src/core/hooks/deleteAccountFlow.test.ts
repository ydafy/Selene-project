import { describe, expect, it } from 'bun:test';
import { runDeleteAccount } from './deleteAccountFlow';
import type { DeleteAccountHttpResponse } from './deleteAccountHelpers';
import type { ReauthResult } from '../auth/reauth.logic';

const REAUTH: DeleteAccountHttpResponse = {
  status: 403,
  body: { error: 'REAUTH_REQUIRED' },
};
const OK: DeleteAccountHttpResponse = { status: 200, body: { success: true } };

const setup = (
  responses: DeleteAccountHttpResponse[],
  reauth: ReauthResult = { ok: true },
) => {
  const calls: string[] = [];
  const queue = [...responses];
  return {
    calls,
    deps: {
      invoke: async () => {
        calls.push('invoke');
        return queue.shift() ?? { status: null, body: null };
      },
      reauthenticate: async () => {
        calls.push('reauth');
        return reauth;
      },
    },
  };
};

describe('runDeleteAccount', () => {
  it('without credentials only calls the function once', async () => {
    const { deps, calls } = setup([OK]);
    expect(await runDeleteAccount({}, deps)).toEqual({ ok: true });
    expect(calls).toEqual(['invoke']);
  });

  it('surfaces REAUTH_REQUIRED so the UI can ask for the identity', async () => {
    const { deps } = setup([REAUTH]);
    expect(await runDeleteAccount({}, deps)).toMatchObject({
      ok: false,
      reauthRequired: true,
    });
  });

  it('re-signs in, then retries the deletion exactly once', async () => {
    const { deps, calls } = setup([OK]);
    const result = await runDeleteAccount(
      { reauth: { kind: 'password', password: 'pw' } },
      deps,
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['reauth', 'invoke']);
  });

  it('a failed re-sign-in never calls the function', async () => {
    const { deps, calls } = setup([OK], {
      ok: false,
      errorKey: 'settings:errors.wrongPassword',
      field: 'password',
    });
    expect(
      await runDeleteAccount(
        { reauth: { kind: 'password', password: 'x' } },
        deps,
      ),
    ).toEqual({
      ok: false,
      errorKey: 'settings:errors.wrongPassword',
      field: 'password',
    });
    expect(calls).toEqual(['reauth']);
  });

  it('a cancelled Google sign-in is silent', async () => {
    const { deps } = setup([OK], { ok: false, errorKey: null });
    expect(
      await runDeleteAccount({ reauth: { kind: 'google' } }, deps),
    ).toEqual({ ok: false, errorKey: '', silent: true });
  });

  it('does not loop when the function still asks for reauthentication', async () => {
    const { deps, calls } = setup([REAUTH, OK]);
    const result = await runDeleteAccount(
      { reauth: { kind: 'password', password: 'pw' } },
      deps,
    );
    expect(result).toEqual({
      ok: false,
      errorKey: 'settings:errors.reauthFailed',
    });
    expect(calls).toEqual(['reauth', 'invoke']);
  });

  it('a blocked deletion after re-sign-in keeps its blocked message', async () => {
    const { deps } = setup([
      {
        status: 409,
        body: { error: 'DELETE_BLOCKED', blocked_reason: 'open_disputes' },
      },
    ]);
    expect(
      await runDeleteAccount({ reauth: { kind: 'google' } }, deps),
    ).toEqual({ ok: false, errorKey: 'settings:blockedReasons.open_disputes' });
  });
});
