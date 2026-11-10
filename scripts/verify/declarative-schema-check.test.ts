import { describe, expect, test } from 'bun:test';

import {
  checkDeclarativeSchema,
  PROBE_NAME,
  type SyncResult,
} from './declarative-schema-check';

const EXISTING = ['20261020100000_remote_schema_baseline.sql'];
const PROBE_FILE = `20261110000000_${PROBE_NAME}.sql`;
const PROBE_SQL = 'ALTER TABLE public.products ADD COLUMN probe text;\n';

function fakeRepo(sync: SyncResult, writesMigration: boolean) {
  const migrations = new Set(EXISTING);
  const removed: string[] = [];
  const syncNames: string[] = [];
  return {
    removed,
    syncNames,
    migrations,
    deps: {
      listMigrations: () => [...migrations],
      runSync: (name: string) => {
        syncNames.push(name);
        if (writesMigration) migrations.add(PROBE_FILE);
        return sync;
      },
      readMigration: (file: string) => (file === PROBE_FILE ? PROBE_SQL : ''),
      removeMigration: (file: string) => {
        removed.push(file);
        migrations.delete(file);
      },
    },
  };
}

describe('checkDeclarativeSchema', () => {
  test('passes when sync finds no schema changes and writes nothing', () => {
    const repo = fakeRepo(
      {
        exitCode: 0,
        output: 'Applying migration x.sql...\nNo schema changes found\n',
      },
      false,
    );

    const result = checkDeclarativeSchema(repo.deps);

    expect(result).toEqual({
      ok: true,
      message: 'supabase/schemas/ matches supabase/migrations/.',
    });
    expect(repo.syncNames).toEqual([PROBE_NAME]);
    expect(repo.removed).toEqual([]);
    expect([...repo.migrations]).toEqual(EXISTING);
  });

  test('fails, shows the migration sync wrote, and removes it', () => {
    const repo = fakeRepo({ exitCode: 0, output: 'Wrote migration\n' }, true);

    const result = checkDeclarativeSchema(repo.deps);

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      [
        'supabase/schemas/ and supabase/migrations/ describe different databases.',
        `sync generated supabase/migrations/${PROBE_FILE} (removed):`,
        PROBE_SQL,
        'Write the migration with `supabase db schema declarative sync -f <name>`, or fix the schema files.',
      ].join('\n'),
    );
    expect(repo.removed).toEqual([PROBE_FILE]);
    expect([...repo.migrations]).toEqual(EXISTING);
  });

  test('fails with the CLI output when sync exits non-zero', () => {
    const repo = fakeRepo(
      { exitCode: 1, output: 'DeclarativeNotEnabledError\n' },
      false,
    );

    const result = checkDeclarativeSchema(repo.deps);

    expect(result).toEqual({
      ok: false,
      message:
        'supabase db schema declarative sync failed (exit 1):\nDeclarativeNotEnabledError\n',
    });
    expect(repo.removed).toEqual([]);
  });

  test('fails closed when sync exits 0 without reporting "No schema changes found"', () => {
    const repo = fakeRepo({ exitCode: 0, output: 'Something else\n' }, false);

    const result = checkDeclarativeSchema(repo.deps);

    expect(result).toEqual({
      ok: false,
      message:
        'supabase db schema declarative sync wrote no migration but did not report "No schema changes found":\nSomething else\n',
    });
  });
});
