// `bun run db:types`: writes packages/types/src/database.types.ts from the local
// database, so the types always match supabase/migrations/ and never a remote
// project that may hold unmerged work or miss an unapplied migration. Run it after
// `supabase db reset`; it only reads the database. The generator prints unformatted
// TypeScript, so the output goes through the repository's Prettier before writing.
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
  '--local',
  '--schema',
  'public',
];

export type Mode = 'write';

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
  deps.writeCommitted(formatted);
  return { ok: true, message: `Wrote ${TYPES_PATH}.` };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const typesFile = join(root, TYPES_PATH);
  const result = await runDatabaseTypes('write', {
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
