// Writes bruno/.env for the Bruno collection from the local Supabase stack of
// the current worktree (each worktree has its own ports and keys), plus the
// optional CRON_SECRET of supabase/functions/.env. The file is gitignored and
// never printed: the CLI only reports which variable names were written.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STATUS_KEYS = [
  ['API_URL', 'SUPABASE_URL'],
  ['ANON_KEY', 'SUPABASE_ANON_KEY'],
  ['SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
] as const;

function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, '$2');
}

function readEnvLines(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return values;
}

function readStatus(statusEnv: string): Record<string, string> {
  const trimmed = statusEnv.trim();
  if (!trimmed) throw new Error('LOCAL_STACK_NOT_RUNNING');
  if (!trimmed.startsWith('{')) return readEnvLines(trimmed);

  // Stack mode prints one JSON object, flat or nested under `env`.
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  const source =
    parsed.env && typeof parsed.env === 'object'
      ? (parsed.env as Record<string, unknown>)
      : parsed;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

function formatValue(value: string): string {
  return /[#"'\s]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

export function buildBrunoEnv(
  statusEnv: string,
  functionsEnv?: string,
): string {
  const status = readStatus(statusEnv);
  if (!status.API_URL) throw new Error('LOCAL_STACK_NOT_RUNNING');

  const { hostname } = new URL(status.API_URL);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error('LOCAL_API_URL_REQUIRED');
  }

  const missing = STATUS_KEYS.map(([key]) => key).filter((key) => !status[key]);
  if (missing.length > 0) {
    throw new Error(`MISSING_STATUS_KEYS: ${missing.join(', ')}`);
  }

  const lines = STATUS_KEYS.map(
    ([key, name]) => `${name}=${formatValue(status[key])}`,
  );
  const cronSecret = functionsEnv
    ? readEnvLines(functionsEnv).CRON_SECRET
    : undefined;
  if (cronSecret) lines.push(`CRON_SECRET=${formatValue(cronSecret)}`);
  return `${lines.join('\n')}\n`;
}

export function brunoEnvVariableNames(envText: string): string[] {
  return envText
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(0, line.indexOf('=')));
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..');
  const status = Bun.spawnSync(['supabase', 'status', '--env'], {
    stderr: 'inherit',
  });
  const functionsEnvPath = join(root, 'supabase', 'functions', '.env');
  const functionsEnv = existsSync(functionsEnvPath)
    ? readFileSync(functionsEnvPath, 'utf8')
    : undefined;

  let envText: string;
  try {
    envText = buildBrunoEnv(status.stdout.toString(), functionsEnv);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    console.error(
      code === 'LOCAL_API_URL_REQUIRED'
        ? 'Refusing to write bruno/.env: the API URL is not local.'
        : code.startsWith('MISSING_STATUS_KEYS')
          ? `Local stack output is incomplete (${code}).`
          : 'Local Supabase stack is not running. Run `supabase start` first.',
    );
    process.exit(1);
  }

  writeFileSync(join(root, 'bruno', '.env'), envText);
  const names = brunoEnvVariableNames(envText);
  console.log(`Wrote bruno/.env with: ${names.join(', ')}`);
  if (!names.includes('CRON_SECRET')) {
    console.log(
      'CRON_SECRET not found in supabase/functions/.env; cron-watchdog-with-secret will fail.',
    );
  }
}
