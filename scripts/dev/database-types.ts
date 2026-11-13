// `bun run db:types`: writes packages/types/src/database.types.ts from the local
// database, so the types always match supabase/migrations/ and never a remote
// project that may hold unmerged work or miss an unapplied migration. Run it after
// `supabase db reset`; it only reads the database. The generator prints unformatted
// TypeScript, so the output goes through the repository's Prettier before writing.
// `bun run db:types:check` (`--check`, CI job `db-test`) compares instead of writing
// and fails when the committed file differs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

export const TYPES_PATH = 'packages/types/src/database.types.ts';
export const GENERATE_COMMAND = [
  'supabase',
  'gen',
  'types',
  'typescript',
  '--schema',
  'public',
];

export type Mode = 'write' | 'check';

const FIX_HINT =
  'Run `supabase db reset` and `bun run db:types`, then commit the file with its migration.';

// An unknown flag must not fall back to writing: in CI it would pass without checking.
export function parseMode(args: string[]): Mode {
  const unknown = args.find((arg) => arg !== '--check');
  if (unknown !== undefined) {
    throw new Error(
      `Unknown argument: ${unknown}. Usage: database-types.ts [--check]`,
    );
  }
  return args.includes('--check') ? 'check' : 'write';
}

function firstDifferentLine(a: string, b: string): number {
  const left = a.split('\n');
  const right = b.split('\n');
  let line = 0;
  while (line < left.length && left[line] === right[line]) line += 1;
  return line + 1;
}

export interface GenerateResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface TypesDeps {
  generate: () => GenerateResult;
  format: (source: string) => Promise<string>;
  readCommitted: () => string | null;
  writeCommitted: (content: string) => void;
}

export async function runDatabaseTypes(
  mode: Mode,
  deps: TypesDeps,
): Promise<{ ok: boolean; message: string }> {
  const generated = deps.generate();
  if (generated.exitCode !== 0) {
    return {
      ok: false,
      message: `supabase gen types failed (exit ${generated.exitCode}). Is the local stack running (\`supabase start\`)?\n${generated.stderr}`,
    };
  }
  if (!generated.stdout.includes('export type Database')) {
    return {
      ok: false,
      message:
        'supabase gen types printed no `Database` type; nothing was written.',
    };
  }

  const formatted = await deps.format(generated.stdout);
  if (mode === 'check') {
    const committed = deps.readCommitted()?.replaceAll('\r\n', '\n');
    if (committed === undefined) {
      return { ok: false, message: `${TYPES_PATH} is missing.\n${FIX_HINT}` };
    }
    if (committed !== formatted) {
      const line = firstDifferentLine(committed, formatted);
      return {
        ok: false,
        message: `${TYPES_PATH} does not match the local database (first difference at line ${line}).\n${FIX_HINT}`,
      };
    }
    return { ok: true, message: `${TYPES_PATH} matches the local database.` };
  }
  deps.writeCommitted(formatted);
  return { ok: true, message: `Wrote ${TYPES_PATH}.` };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const typesFile = join(root, TYPES_PATH);
  const mode = parseMode(process.argv.slice(2));
  const result = await runDatabaseTypes(mode, {
    generate: () => {
      const run = Bun.spawnSync(GENERATE_COMMAND, {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return {
        exitCode: run.exitCode,
        stdout: run.stdout.toString(),
        stderr: run.stderr.toString(),
      };
    },
    format: async (source) => {
      const config = await resolveConfig(typesFile);
      return format(source, { ...config, filepath: typesFile });
    },
    readCommitted: () => {
      try {
        return readFileSync(typesFile, 'utf8');
      } catch {
        return null;
      }
    },
    writeCommitted: (content) => writeFileSync(typesFile, content),
  });
  console[result.ok ? 'log' : 'error'](result.message);
  process.exit(result.ok ? 0 : 1);
}
