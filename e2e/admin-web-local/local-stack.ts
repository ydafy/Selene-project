// Reads this worktree's local Supabase stack for the real-backend E2E specs.
// Each worktree has its own ports and keys, so they come from `supabase status --env`.
// Refuses anything that is not a local URL: these specs write data.

import { execFileSync, execSync } from 'node:child_process';

export interface LocalStack {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  dbUrl: string;
}

const isLocalHost = (url: string) => {
  const { hostname } = new URL(url);
  return hostname === '127.0.0.1' || hostname === 'localhost';
};

export function parseLocalStack(statusEnv: string): LocalStack {
  const parsed = JSON.parse(statusEnv.trim()) as Record<string, unknown>;
  const read = (key: string) =>
    typeof parsed[key] === 'string' ? (parsed[key] as string) : '';
  const apiUrl = read('API_URL');
  const publishableKey = read('PUBLISHABLE_KEY');
  const secretKey = read('SECRET_KEY');
  const dbUrl = read('DB_URL');
  if (!apiUrl || !publishableKey || !secretKey || !dbUrl)
    throw new Error('LOCAL_STACK_NOT_RUNNING');

  if (!isLocalHost(apiUrl)) throw new Error('LOCAL_API_URL_REQUIRED');
  if (!isLocalHost(dbUrl)) throw new Error('LOCAL_DB_URL_REQUIRED');
  return { apiUrl, publishableKey, secretKey, dbUrl };
}

export function readLocalStack(): LocalStack {
  let output: string;
  try {
    output = execSync('supabase status --env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(
      'LOCAL_STACK_NOT_RUNNING: run `supabase start` in this worktree.',
    );
  }
  return parseLocalStack(output);
}

// Runs one SQL statement as the database owner. service_role has no privilege on the
// tables only RPCs may reach (shipment_cancellation_operations and the Connect event
// tables), so fixture cleanup and assertions on them go through this connection.
// `supabase db query` without `--remote` targets this worktree's local stack (CLI v3).
function runOwnerSql(stack: LocalStack, sql: string): string {
  if (!isLocalHost(stack.dbUrl)) throw new Error('LOCAL_DB_URL_REQUIRED');
  return execFileSync('supabase', ['db', 'query', '-o', 'json', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function ownerExec(stack: LocalStack, sql: string): void {
  runOwnerSql(stack, sql);
}

export function ownerQuery<T>(stack: LocalStack, sql: string): T[] {
  return (JSON.parse(runOwnerSql(stack, sql)) as { rows: T[] }).rows;
}

// Quotes a value for the SQL passed to ownerExec and ownerQuery.
export const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;
