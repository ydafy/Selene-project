import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareDrift,
  localFunctionSlugs,
  localMigrationVersions,
  parseDeployedFunctions,
  parseRemoteMigrations,
} from './staging-drift';

const SCRIPT = join(import.meta.dir, 'staging-drift.ts');

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// The shape `supabase migration list --remote --output-format json` prints in
// CLI 3.1.0 (captured from the local stack; the remote target only changes
// `target`). A version missing on one side has an empty string there.
function migrationList(
  rows: { local: string; remote: string }[],
): Record<string, unknown> {
  return {
    migrations: rows.map((row) => ({ ...row, time: '2026-10-20 10:00:00' })),
    message: 'Migrations listed',
    target: { kind: 'remote', ref: 'abcdefghijklmnopqrst' },
  };
}

// The shape `supabase functions list --output-format json` prints in CLI
// 3.1.0: the Management API function objects under `functions`.
function functionList(slugs: string[]): Record<string, unknown> {
  return {
    functions: slugs.map((slug, index) => ({
      id: `id-${index}`,
      slug,
      name: slug,
      status: 'ACTIVE',
      version: 3,
      verify_jwt: false,
    })),
    message: '',
  };
}

const VERSIONS = ['20261020100000', '20261126005538'];
const SLUGS = ['cancel-order', 'stripe-webhooks'];

function repository(
  versions: string[] = VERSIONS,
  slugs: string[] = SLUGS,
): string {
  const root = mkdtempSync(join(tmpdir(), 'staging-drift-'));
  roots.push(root);
  const migrations = join(root, 'supabase', 'migrations');
  mkdirSync(join(migrations, 'archive'), { recursive: true });
  for (const version of versions)
    writeFileSync(join(migrations, `${version}_change.sql`), 'select 1;\n');
  // Pre-baseline history is never applied, so it never counts.
  writeFileSync(
    join(migrations, 'archive', '20250101000000_old.sql'),
    'select 1;\n',
  );
  const functions = join(root, 'supabase', 'functions');
  for (const slug of [...slugs, '_shared', '__tests__'])
    mkdirSync(join(functions, slug), { recursive: true });
  writeFileSync(join(functions, 'deno.json'), '{}\n');
  writeFileSync(join(functions, 'AGENTS.md'), '# guide\n');
  return root;
}

function check(
  root: string,
  migrations: unknown,
  functions: unknown,
): { exitCode: number | null; stdout: string; stderr: string } {
  const scratch = mkdtempSync(join(tmpdir(), 'staging-drift-input-'));
  roots.push(scratch);
  const write = (name: string, value: unknown) => {
    const path = join(scratch, name);
    writeFileSync(
      path,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
    return path;
  };
  const run = Bun.spawnSync(
    [
      'bun',
      SCRIPT,
      '--root',
      root,
      '--migrations',
      write('migrations.json', migrations),
      '--functions',
      write('functions.json', functions),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

const applied = (versions: string[]) =>
  versions.map((version) => ({ local: version, remote: version }));

describe('local inventories', () => {
  it('takes the version prefix of each top-level migration file', () => {
    expect(
      localMigrationVersions([
        '20261020100000_remote_schema_baseline.sql',
        '20261126005538_change.sql',
        'archive',
      ]),
    ).toEqual(['20261020100000', '20261126005538']);
  });

  it('rejects a migration file without a version prefix', () => {
    expect(() => localMigrationVersions(['baseline.sql'])).toThrow(
      'supabase/migrations/baseline.sql has no <version>_<name>.sql name',
    );
  });

  it('ignores _shared and __tests__', () => {
    expect(
      localFunctionSlugs(['_shared', '__tests__', 'cancel-order']),
    ).toEqual(['cancel-order']);
  });
});

describe('remote listings', () => {
  it('reads the remote versions and skips local-only rows', () => {
    expect(
      parseRemoteMigrations(
        migrationList([
          { local: '20261020100000', remote: '20261020100000' },
          { local: '20261126005538', remote: '' },
        ]),
      ),
    ).toEqual(['20261020100000']);
  });

  it('reads the deployed slugs', () => {
    expect(parseDeployedFunctions(functionList(SLUGS))).toEqual(SLUGS);
  });

  it('rejects the CLI error object', () => {
    const error = { _tag: 'Error', error: { code: 'X', message: 'x' } };
    expect(() => parseRemoteMigrations(error)).toThrow();
    expect(() => parseDeployedFunctions(error)).toThrow();
  });
});

describe('compareDrift', () => {
  it('reports nothing for equal sets', () => {
    expect(compareDrift(VERSIONS, VERSIONS, SLUGS, SLUGS)).toEqual({
      migrationsNotApplied: [],
      migrationsNotInRepository: [],
      functionsNotDeployed: [],
      functionsNotInRepository: [],
    });
  });

  it('reports each side of every difference, sorted', () => {
    expect(
      compareDrift(['3', '1', '2'], ['1', '4'], ['b', 'a'], ['a', 'extra']),
    ).toEqual({
      migrationsNotApplied: ['2', '3'],
      migrationsNotInRepository: ['4'],
      functionsNotDeployed: ['b'],
      functionsNotInRepository: ['extra'],
    });
  });
});

describe('staging-drift CLI', () => {
  it('passes when the remote matches the repository', () => {
    expect(
      check(
        repository(),
        migrationList(applied(VERSIONS)),
        functionList(SLUGS),
      ),
    ).toEqual({
      exitCode: 0,
      stdout:
        'staging-drift: 2 migrations and 2 functions match the repository.\n',
      stderr: '',
    });
  });

  it('fails on a repository migration the remote has not applied', () => {
    expect(
      check(
        repository(),
        migrationList([
          { local: VERSIONS[0], remote: VERSIONS[0] },
          { local: VERSIONS[1], remote: '' },
        ]),
        functionList(SLUGS),
      ),
    ).toEqual({
      exitCode: 1,
      stdout: '',
      stderr:
        'Migration 20261126005538: in supabase/migrations/ but not applied on the remote.\n' +
        'staging-drift: the remote differs from the repository.\n',
    });
  });

  it('fails on a remote migration missing from the repository', () => {
    expect(
      check(
        repository([VERSIONS[0]]),
        migrationList([
          { local: VERSIONS[0], remote: VERSIONS[0] },
          { local: '', remote: VERSIONS[1] },
        ]),
        functionList(SLUGS),
      ),
    ).toEqual({
      exitCode: 1,
      stdout: '',
      stderr:
        'Migration 20261126005538: applied on the remote but missing from supabase/migrations/.\n' +
        'staging-drift: the remote differs from the repository.\n',
    });
  });

  it('fails on a deployed function missing from the repository', () => {
    expect(
      check(
        repository(),
        migrationList(applied(VERSIONS)),
        functionList([...SLUGS, 'old-function']),
      ),
    ).toEqual({
      exitCode: 1,
      stdout: '',
      stderr:
        'Function old-function: deployed but missing from supabase/functions/.\n' +
        'staging-drift: the remote differs from the repository.\n',
    });
  });

  it('fails on a function directory that is not deployed', () => {
    expect(
      check(
        repository(),
        migrationList(applied(VERSIONS)),
        functionList([SLUGS[0]]),
      ),
    ).toEqual({
      exitCode: 1,
      stdout: '',
      stderr:
        'Function stripe-webhooks: in supabase/functions/ but not deployed.\n' +
        'staging-drift: the remote differs from the repository.\n',
    });
  });

  it('fails closed on a migration listing that is not JSON', () => {
    const result = check(repository(), 'Target: remote', functionList(SLUGS));
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'staging-drift: the migration list is not JSON: Target: remote',
    );
  });

  it('fails closed on the CLI error object', () => {
    const result = check(repository(), migrationList(applied(VERSIONS)), {
      _tag: 'Error',
      error: { code: 'X', message: 'unauthorized' },
    });
    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        'staging-drift: the function list is not the output of `supabase functions list --output-format json`.\n',
    });
  });

  it('fails closed on a row whose remote version is not a version', () => {
    const result = check(
      repository(),
      migrationList([{ local: VERSIONS[0], remote: 'abc' }]),
      functionList(SLUGS),
    );
    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        'staging-drift: the migration list is not the output of `supabase migration list --output-format json`.\n',
    });
  });

  it('fails closed on an empty remote listing', () => {
    const result = check(repository(), migrationList([]), functionList([]));
    expect(result.exitCode).toBe(1);
  });

  it('prints usage and exits 2 without both inputs', () => {
    const run = Bun.spawnSync(['bun', SCRIPT, '--migrations', 'x.json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toBe(
      'Usage: bun scripts/ci/staging-drift.ts --migrations <list.json> --functions <list.json> [--root <dir>]\n',
    );
  });
});

describe('staging-drift CLI, more fail-closed cases', () => {
  it('exits 2 on a repository migration without a version prefix', () => {
    const root = repository();
    writeFileSync(
      join(root, 'supabase', 'migrations', 'baseline.sql'),
      'select 1;\n',
    );
    expect(
      check(root, migrationList(applied(VERSIONS)), functionList(SLUGS)),
    ).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        'staging-drift: supabase/migrations/baseline.sql has no <version>_<name>.sql name\n',
    });
  });

  it('exits 2 on a function row without a slug', () => {
    expect(
      check(repository(), migrationList(applied(VERSIONS)), {
        functions: [{ id: 'x' }],
      }),
    ).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        'staging-drift: the function list is not the output of `supabase functions list --output-format json`.\n',
    });
  });

  it('prints usage and exits 2 on an unknown flag', () => {
    const run = Bun.spawnSync(
      [
        'bun',
        SCRIPT,
        '--migrations',
        'a.json',
        '--functions',
        'b.json',
        '--prune',
        'x',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toStartWith(
      'Usage: bun scripts/ci/staging-drift.ts',
    );
  });
});

// source-text: the workflow runs only on GitHub against staging, so its text is the contract tested here.
describe('deploy-staging workflow', () => {
  const workflow = readFileSync(
    join(
      import.meta.dir,
      '..',
      '..',
      '.github',
      'workflows',
      'deploy-staging.yml',
    ),
    'utf8',
  );

  it('takes the drift check from main on a rollback, since an older commit may lack it', () => {
    expect(workflow).toMatch(
      /git archive origin\/main supabase\/migrations supabase\/functions scripts\/ci\/staging-drift\.ts/,
    );
    expect(workflow).toContain(
      'bun "$root/scripts/ci/staging-drift.ts" --root "$root"',
    );
  });

  it('is called by ci.yml with inherited credentials, which the staging environment needs', () => {
    const ci = readFileSync(
      join(import.meta.dir, '..', '..', '.github', 'workflows', 'ci.yml'),
      'utf8',
    );
    const rest = ci.slice(ci.indexOf('\n  deploy-staging:') + 1);
    const next = rest.slice(1).search(/^ {2}[a-z][\w-]*:/m);
    const job = next === -1 ? rest : rest.slice(0, next + 1);
    expect(job).toContain('uses: ./.github/workflows/deploy-staging.yml');
    expect(job).toMatch(/^ {4}secrets: inherit\b/m);
    expect(workflow).toContain('environment: staging');
  });

  it('deploys the functions through the retry wrapper, taken from main on a rollback', () => {
    expect(workflow).toContain(
      'git show origin/main:scripts/ci/retry-transient.ts > "$script"',
    );
    expect(workflow).toContain(
      'bun "$script" -- supabase functions deploy --use-api --yes',
    );
  });

  it('never prunes functions or pushes the config', () => {
    const commands = workflow
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(commands).not.toContain('--prune');
    expect(commands).not.toContain('config push');
  });
});
