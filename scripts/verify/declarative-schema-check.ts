// `bun run db:schema:check`: fails when supabase/schemas/ and supabase/migrations/
// describe different databases. It runs `supabase db schema declarative sync --no-apply`,
// which builds a shadow database from the migrations and writes a migration only when
// the schema files differ from it; any migration it writes is shown and removed.
// Needs the local stack (`supabase start`); it never touches the local or remote data.
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROBE_NAME = 'declarative_schema_check';
const NO_CHANGES = 'No schema changes found';

export interface SyncResult {
  exitCode: number;
  output: string;
}

export interface CheckDeps {
  listMigrations: () => string[];
  runSync: (name: string) => SyncResult;
  readMigration: (file: string) => string;
  removeMigration: (file: string) => void;
}

export function checkDeclarativeSchema(deps: CheckDeps): {
  ok: boolean;
  message: string;
} {
  const before = new Set(deps.listMigrations());
  const sync = deps.runSync(PROBE_NAME);
  const added = deps
    .listMigrations()
    .filter((file) => !before.has(file))
    .sort();

  if (added.length > 0) {
    const lines = [
      'supabase/schemas/ and supabase/migrations/ describe different databases.',
    ];
    for (const file of added) {
      lines.push(
        `sync generated supabase/migrations/${file} (removed):`,
        deps.readMigration(file),
      );
      deps.removeMigration(file);
    }
    lines.push(
      'Write the migration with `supabase db schema declarative sync -f <name>`, or fix the schema files.',
    );
    return { ok: false, message: lines.join('\n') };
  }
  if (sync.exitCode !== 0) {
    return {
      ok: false,
      message: `supabase db schema declarative sync failed (exit ${sync.exitCode}):\n${sync.output}`,
    };
  }
  if (!sync.output.includes(NO_CHANGES)) {
    return {
      ok: false,
      message: `supabase db schema declarative sync wrote no migration but did not report "${NO_CHANGES}":\n${sync.output}`,
    };
  }
  return {
    ok: true,
    message: 'supabase/schemas/ matches supabase/migrations/.',
  };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const migrationsDir = join(root, 'supabase', 'migrations');
  const result = checkDeclarativeSchema({
    listMigrations: () =>
      readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')),
    runSync: (name) => {
      const run = Bun.spawnSync(
        [
          'supabase',
          'db',
          'schema',
          'declarative',
          'sync',
          '--no-apply',
          '-f',
          name,
        ],
        { cwd: root, stdout: 'pipe', stderr: 'pipe' },
      );
      return {
        exitCode: run.exitCode,
        output: `${run.stdout.toString()}${run.stderr.toString()}`,
      };
    },
    readMigration: (file) => readFileSync(join(migrationsDir, file), 'utf8'),
    removeMigration: (file) => rmSync(join(migrationsDir, file)),
  });
  console[result.ok ? 'log' : 'error'](result.message);
  process.exit(result.ok ? 0 : 1);
}
