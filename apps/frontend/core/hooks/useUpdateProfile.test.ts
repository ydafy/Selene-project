import { expect, test, describe } from 'bun:test';
import {
  updateProfileUsername,
  mapUpdateProfileError,
} from './updateProfileUsername';

interface MockUpdateQuery {
  from: (table: string) => MockUpdateQuery;
  update: (payload: Record<string, unknown>) => MockUpdateQuery;
  eq: (col: string, val: string) => MockUpdateQuery;
  then: (cb: (v: any) => any) => Promise<any>;
}

function createMockClient(
  response: { error?: { code?: string; message?: string } | null },
  recorder?: {
    table?: string;
    payload?: Record<string, unknown>;
    eqArgs?: [string, string];
  },
): MockUpdateQuery {
  const chain: MockUpdateQuery = {
    from: (table) => {
      if (recorder) recorder.table = table;
      return chain;
    },
    update: (payload) => {
      if (recorder) recorder.payload = payload;
      return chain;
    },
    eq: (col, val) => {
      if (recorder) recorder.eqArgs = [col, val];
      return chain;
    },
    then: (cb) =>
      Promise.resolve(cb({ data: null, error: response.error ?? null })),
  };
  return chain;
}

describe('updateProfileUsername', () => {
  test('calls profiles.update with correct username and id', async () => {
    const recorder: any = {};
    const client = createMockClient({ error: null }, recorder);

    await updateProfileUsername('user-1', 'newname', client as any);

    expect(recorder.table).toBe('profiles');
    expect(recorder.payload).toEqual({ username: 'newname' });
    expect(recorder.eqArgs).toEqual(['id', 'user-1']);
  });

  test('resolves on success', async () => {
    const client = createMockClient({ error: null });
    await expect(
      updateProfileUsername('user-1', 'ok', client as any),
    ).resolves.toBeUndefined();
  });

  test('throws error from supabase', async () => {
    const client = createMockClient({
      error: { code: '23505', message: 'duplicate' },
    });
    await expect(
      updateProfileUsername('user-1', 'taken', client as any),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('mapUpdateProfileError', () => {
  test('maps Postgres 23505 to usernameTaken key', () => {
    expect(mapUpdateProfileError({ code: '23505' })).toBe(
      'settings:errors.usernameTaken',
    );
  });

  test('maps unknown error to updateFailed key', () => {
    expect(mapUpdateProfileError({ code: '99999' })).toBe(
      'settings:errors.updateFailed',
    );
  });

  test('maps null/undefined to updateFailed key', () => {
    expect(mapUpdateProfileError(null)).toBe('settings:errors.updateFailed');
    expect(mapUpdateProfileError(undefined)).toBe(
      'settings:errors.updateFailed',
    );
  });

  test('maps error without code to updateFailed key', () => {
    expect(mapUpdateProfileError({ message: 'boom' })).toBe(
      'settings:errors.updateFailed',
    );
  });
});
