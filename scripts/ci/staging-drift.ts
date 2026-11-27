// Compares the remote project with the repository after a deploy: the remote
// migration history against supabase/migrations/*.sql (top level only;
// archive/ is never applied), and the deployed function slugs against the
// directories of supabase/functions/ except _shared and __tests__. It reads
// the saved JSON output of `supabase migration list --remote --output-format
// json` and `supabase functions list --output-format json` (CLI 3.1.0) and
// exits 1 on any difference, 2 on unreadable or malformed input.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const USAGE =
  'Usage: bun scripts/ci/staging-drift.ts --migrations <list.json> --functions <list.json> [--root <dir>]';
const MIGRATION_FILE = /^(\d+)_.*\.sql$/;
const VERSION = /^\d+$/;
const IGNORED_FUNCTION_DIRS = new Set(['_shared', '__tests__']);

export type Drift = {
  migrationsNotApplied: string[];
  migrationsNotInRepository: string[];
  functionsNotDeployed: string[];
  functionsNotInRepository: string[];
};

export function localMigrationVersions(fileNames: string[]): string[] {
  return fileNames
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = name.match(MIGRATION_FILE);
      if (!match)
        throw new Error(
          `supabase/migrations/${name} has no <version>_<name>.sql name`,
        );
      return match[1];
    });
}

export function localFunctionSlugs(dirNames: string[]): string[] {
  return dirNames.filter((name) => !IGNORED_FUNCTION_DIRS.has(name));
}

function listUnder(output: unknown, key: string): unknown[] | undefined {
  if (typeof output !== 'object' || output === null) return undefined;
  const list = (output as Record<string, unknown>)[key];
  return Array.isArray(list) ? list : undefined;
}

// A row has `remote` as an empty string when only the repository has it.
export function parseRemoteMigrations(output: unknown): string[] {
  const rows = listUnder(output, 'migrations');
  const fail = () => {
    throw new Error(
      'the migration list is not the output of `supabase migration list --output-format json`.',
    );
  };
  if (!rows) return fail();
  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return fail();
    const remote = (row as Record<string, unknown>).remote;
    if (typeof remote !== 'string') return fail();
    if (remote === '') return [];
    return VERSION.test(remote) ? [remote] : fail();
  });
}

export function parseDeployedFunctions(output: unknown): string[] {
  const rows = listUnder(output, 'functions');
  const fail = () => {
    throw new Error(
      'the function list is not the output of `supabase functions list --output-format json`.',
    );
  };
  if (!rows) return fail();
  return rows.map((row) => {
    const slug =
      typeof row === 'object' && row !== null
        ? (row as Record<string, unknown>).slug
        : undefined;
    return typeof slug === 'string' && slug !== '' ? slug : fail();
  });
}

function missingFrom(source: string[], target: string[]): string[] {
  const present = new Set(target);
  return [...new Set(source)].filter((item) => !present.has(item)).sort();
}

export function compareDrift(
  localVersions: string[],
  remoteVersions: string[],
  localSlugs: string[],
  deployedSlugs: string[],
): Drift {
  return {
    migrationsNotApplied: missingFrom(localVersions, remoteVersions),
    migrationsNotInRepository: missingFrom(remoteVersions, localVersions),
    functionsNotDeployed: missingFrom(localSlugs, deployedSlugs),
    functionsNotInRepository: missingFrom(deployedSlugs, localSlugs),
  };
}

function readJson(path: string, label: string): unknown {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`the ${label} is not JSON: ${text.slice(0, 500)}`);
  }
}

function parseArgs(args: string[]): Record<string, string> | undefined {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (!['--migrations', '--functions', '--root'].includes(flag) || !value)
      return undefined;
    options[flag.slice(2)] = value;
  }
  return options.migrations && options.functions ? options : undefined;
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error(USAGE);
    return 2;
  }
  const root = options.root ?? join(import.meta.dir, '..', '..');

  let drift: Drift;
  let counts: { migrations: number; functions: number };
  try {
    const remoteVersions = parseRemoteMigrations(
      readJson(options.migrations, 'migration list'),
    );
    const deployedSlugs = parseDeployedFunctions(
      readJson(options.functions, 'function list'),
    );
    const localVersions = localMigrationVersions(
      readdirSync(join(root, 'supabase', 'migrations'), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name),
    );
    const localSlugs = localFunctionSlugs(
      readdirSync(join(root, 'supabase', 'functions'), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
    drift = compareDrift(
      localVersions,
      remoteVersions,
      localSlugs,
      deployedSlugs,
    );
    counts = { migrations: localVersions.length, functions: localSlugs.length };
  } catch (error) {
    console.error(`staging-drift: ${(error as Error).message}`);
    return 2;
  }

  const lines = [
    ...drift.migrationsNotApplied.map(
      (version) =>
        `Migration ${version}: in supabase/migrations/ but not applied on the remote.`,
    ),
    ...drift.migrationsNotInRepository.map(
      (version) =>
        `Migration ${version}: applied on the remote but missing from supabase/migrations/.`,
    ),
    ...drift.functionsNotDeployed.map(
      (slug) => `Function ${slug}: in supabase/functions/ but not deployed.`,
    ),
    ...drift.functionsNotInRepository.map(
      (slug) =>
        `Function ${slug}: deployed but missing from supabase/functions/.`,
    ),
  ];
  if (lines.length > 0) {
    for (const line of lines) console.error(line);
    console.error('staging-drift: the remote differs from the repository.');
    return 1;
  }
  console.log(
    `staging-drift: ${counts.migrations} migrations and ${counts.functions} functions match the repository.`,
  );
  return 0;
}

if (import.meta.main) process.exit(main());
