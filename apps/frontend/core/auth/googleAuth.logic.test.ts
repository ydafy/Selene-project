import { describe, expect, it } from 'bun:test';

import {
  GOOGLE_ERROR_KEY,
  GOOGLE_NO_ID_TOKEN,
  resolveGoogleError,
} from './googleAuth.logic';

const CANCELLED = '12501';

describe('resolveGoogleError', () => {
  it('stays silent when the user cancels', () => {
    expect(resolveGoogleError({ code: CANCELLED }, CANCELLED)).toEqual({
      silent: true,
    });
  });

  it('maps a Supabase auth error by code', () => {
    expect(
      resolveGoogleError(
        { name: 'AuthApiError', code: 'signup_disabled', message: 'raw', status: 422 },
        CANCELLED,
      ),
    ).toEqual({ silent: false, key: 'auth:errors.signupDisabled' });
  });

  it('uses the Google key for a missing ID token', () => {
    expect(
      resolveGoogleError({ code: GOOGLE_NO_ID_TOKEN }, CANCELLED),
    ).toEqual({ silent: false, key: GOOGLE_ERROR_KEY });
  });

  it('never exposes the raw message of an unknown error', () => {
    const result = resolveGoogleError(new Error('DEVELOPER_ERROR raw'), CANCELLED);
    expect(result).toEqual({ silent: false, key: 'auth:errors.googleSignInFailed' });
  });
});
