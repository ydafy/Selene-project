// Lints migrations with Squawk (rules in .squawk.toml) and requires a reason for
// every rule a migration silences. CI passes `--base <commit>` to lint only the
// migrations a pull request adds; locally, pass the files to lint.
// How to read a rule and silence one: supabase/AGENTS.md, "Migration lint".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const CONFIG = join(REPO_ROOT, '.squawk.toml');
const USAGE =
  'Usage: bun scripts/ci/lint-migrations.ts [--base <commit>] [file.sql ...]';

// Squawk reads an ignore in any comment: a line comment, a trailing one, or a
// block comment.
const IGNORE = /(--|\/\*).*\bsquawk-ignore(-file)?\b/;
const REASON = /^\s*--\s*reason:\s*\S/;
const MIGRATION = /^supabase\/migrations\/[^/]+\.sql$/;

export function findIgnoresWithoutReason(file: string, sql: string): string[] {
  const lines = sql.split(/\r?\n/);
  const errors: string[] = [];
  lines.forEach((line, index) => {
    if (IGNORE.test(line) && !REASON.test(lines[index - 1] ?? ''))
      errors.push(
        `${file}:${index + 1}: squawk-ignore needs a "-- reason: <why>" comment on the line above it.`,
      );
  });
  return errors;
}

export function selectMigrations(paths: string[]): string[] {
  return paths.filter((path) => MIGRATION.test(path));
}

// CI passes the first parent of the pull request's merge commit, so a two-dot
// diff lists exactly the files the PR adds. --no-renames lists a migration that
// git would pair with a deleted file as added, so it is linted too.
function addedMigrations(base: string): string[] {
  const diff = Bun.spawnSync(
    [
      'git',
      'diff',
      '--name-only',
      '--diff-filter=A',
      '--no-renames',
      base,
      'HEAD',
      '--',
      'supabase/migrations',
    ],
    { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' },
  );
  if (diff.exitCode !== 0)
    throw new Error(
      `lint-migrations: git diff against ${base} failed: ${diff.stderr.toString().trim()}`,
    );
  return selectMigrations(diff.stdout.toString().split('\n')).map((path) =>
    join(REPO_ROOT, path),
  );
}

function parseArgs(args: string[]): { base?: string; files: string[] } | null {
  const files: string[] = [];
  let base: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--base') {
      base = args[++i];
      if (!base) return null;
    } else if (arg.startsWith('-')) return null;
    else files.push(arg);
  }
  return { base, files };
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(USAGE);
    return 2;
  }
  const files = [
    ...parsed.files,
    ...(parsed.base ? addedMigrations(parsed.base) : []),
  ];
  if (files.length === 0) {
    console.log('lint-migrations: no new migrations to lint.');
    return 0;
  }

  const reasonErrors = files.flatMap((file) =>
    findIgnoresWithoutReason(file, readFileSync(file, 'utf8')),
  );
  for (const error of reasonErrors) console.error(error);

  const squawk = Bun.spawnSync(
    [
      'bun',
      require.resolve('squawk-cli/js/bin/squawk'),
      '--config',
      CONFIG,
      ...files,
    ],
    { cwd: REPO_ROOT, stdout: 'inherit', stderr: 'inherit' },
  );
  return squawk.exitCode === 0 && reasonErrors.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
