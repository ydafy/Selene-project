// Reads this worktree's local Supabase stack for the real-backend E2E specs.
// Each worktree has its own ports and keys, so they come from `supabase status --env`.
// Refuses anything that is not a local URL: these specs write data.

import { execSync } from 'node:child_process';

export interface LocalStack {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

export function parseLocalStack(statusEnv: string): LocalStack {
  const parsed = JSON.parse(statusEnv.trim()) as Record<string, unknown>;
  const read = (key: string) => (typeof parsed[key] === 'string' ? (parsed[key] as string) : '');
  const apiUrl = read('API_URL');
  const anonKey = read('ANON_KEY');
  const serviceRoleKey = read('SERVICE_ROLE_KEY');
  if (!apiUrl || !anonKey || !serviceRoleKey) throw new Error('LOCAL_STACK_NOT_RUNNING');

  const { hostname } = new URL(apiUrl);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new Error('LOCAL_API_URL_REQUIRED');
  return { apiUrl, anonKey, serviceRoleKey };
}

export function readLocalStack(): LocalStack {
  let output: string;
  try {
    output = execSync('supabase status --env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('LOCAL_STACK_NOT_RUNNING: run `supabase start` in this worktree.');
  }
  return parseLocalStack(output);
}
