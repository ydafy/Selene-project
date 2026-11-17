// Copies the maintainer-owned env files (gitignored, so git never brings them)
// from the main checkout into a worktree. Runs automatically from the
// post-checkout hook when `git worktree add` creates a worktree, and by hand with
// `bun run worktree:env` (add `--force` to overwrite). Then compares the variable
// names of each env file with its `.example` and prints what differs, so a copy
// made before a variable was renamed does not fail silently (#667). Never prints
// file contents or values.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ENV_FILES = [
  'apps/frontend/.env',
  'apps/admin-web/.env',
  'supabase/functions/.env',
] as const;

export type CopyOutcome = 'copied' | 'kept-existing' | 'missing-in-main';

export interface CopyResult {
  file: string;
  outcome: CopyOutcome;
}

export function mainWorktreeFromPorcelain(porcelain: string): string | null {
  const line = porcelain
    .split(/\r?\n/)
    .find((entry) => entry.startsWith('worktree '));
  return line ? line.slice('worktree '.length).trim() : null;
}

export function copyWorktreeEnv(options: {
  mainRoot: string;
  targetRoot: string;
  force?: boolean;
}): CopyResult[] {
  if (resolve(options.mainRoot) === resolve(options.targetRoot)) return [];

  return ENV_FILES.map((file) => {
    const source = join(options.mainRoot, file);
    const target = join(options.targetRoot, file);
    if (!existsSync(source)) return { file, outcome: 'missing-in-main' };
    if (existsSync(target) && !options.force)
      return { file, outcome: 'kept-existing' };
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    return { file, outcome: 'copied' };
  });
}

export interface EnvNameDrift {
  missing: string[];
  extra: string[];
}

export interface EnvNameCheck extends EnvNameDrift {
  file: string;
}

const ENV_NAME = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

function envNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_NAME.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

export function envNameDrift(
  envText: string,
  exampleText: string,
): EnvNameDrift {
  const env = envNames(envText);
  const example = envNames(exampleText);
  return {
    missing: [...example].filter((name) => !env.has(name)),
    extra: [...env].filter((name) => !example.has(name)),
  };
}

export function checkEnvNames(root: string): EnvNameCheck[] {
  return ENV_FILES.flatMap((file) => {
    const envPath = join(root, file);
    const examplePath = `${envPath}.example`;
    if (!existsSync(envPath) || !existsSync(examplePath)) return [];
    return [
      {
        file,
        ...envNameDrift(
          readFileSync(envPath, 'utf8'),
          readFileSync(examplePath, 'utf8'),
        ),
      },
    ];
  });
}

export function formatEnvNameDrift(checks: EnvNameCheck[]): string[] {
  return checks.flatMap(({ file, missing, extra }) => [
    ...missing.map(
      (name) => `[worktree-env] ${file} lacks ${name} from ${file}.example`,
    ),
    ...extra.map(
      (name) =>
        `[worktree-env] ${file} has ${name}, which ${file}.example does not list`,
    ),
  ]);
}

function git(args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return result.stdout.toString().trim();
}

if (import.meta.main) {
  try {
    const mainRoot = mainWorktreeFromPorcelain(
      git(['worktree', 'list', '--porcelain']),
    );
    const targetRoot = git(['rev-parse', '--show-toplevel']);
    if (!mainRoot) throw new Error('could not find the main checkout');

    const results = copyWorktreeEnv({
      mainRoot,
      targetRoot,
      force: Bun.argv.includes('--force'),
    });
    if (results.length === 0)
      console.log('[worktree-env] main checkout: nothing to copy');
    for (const { file, outcome } of results)
      console.log(`[worktree-env] ${outcome}: ${file}`);
    for (const line of formatEnvNameDrift(checkEnvNames(targetRoot)))
      console.warn(line);
  } catch (error) {
    // Never block a checkout because of this helper.
    console.error(
      `[worktree-env] skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
