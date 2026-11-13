import { SQL } from 'bun';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const help =
  'Usage: bun scripts/verify/test-account-closure-cleanup.ts [--help]\n' +
  'End to end: the account-closure-cleanup cron worker against the local stack. A closure whose\n' +
  'Storage step failed, idle for years, is retried: the claim counts the only attempt and the\n' +
  'worker records the step through fn_record_closure_cleanup_step. A closure at the attempt cap\n' +
  'is not claimed and is reported through fn_list_capped_account_closures.\n' +
  'internal.account_closures is not exposed through PostgREST, so the setup and the read-back use\n' +
  'a direct owner connection; the action under test goes through the worker over HTTP.\n' +
  "Runs against this worktree's local Supabase stack (`supabase start`) with the functions server\n" +
  '(`bun run functions:serve`) and CRON_SECRET in bruno/.env (`bun run bruno:env`). Every case\n' +
  'deletes the users and closures it created.\n' +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ROOT = join(import.meta.dir, '..', '..');
const MAX_ATTEMPTS = 24;

type Status = { DB_URL?: string; API_URL?: string };
type WorkerResult = {
  claimed: number;
  completed: number;
  failed: number;
  invalid: number;
  capped: { user_id: string; attempts: number }[];
};

function stackStatus(): Status {
  const status = Bun.spawnSync(['supabase', 'status', '--env'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (status.exitCode !== 0)
    throw new Error(
      'Local Supabase stack is not running for this worktree: run `supabase start`.',
    );
  const parsed = JSON.parse(status.stdout.toString()) as Record<
    string,
    unknown
  >;
  const env = (
    parsed.env && typeof parsed.env === 'object' ? parsed.env : parsed
  ) as Status;
  return env;
}

// Never touch a remote project: this harness writes data.
function requireLocal(url: string, what: string): string {
  if (!url) throw new Error(`No local ${what} URL found.`);
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost')
    throw new Error(`Refusing non-local ${what} host: ${host}`);
  return url;
}

function cronSecret(): string {
  const path = join(ROOT, 'bruno', '.env');
  const line = existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .find((entry) => entry.startsWith('CRON_SECRET='))
    : undefined;
  const value = line
    ?.slice('CRON_SECRET='.length)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\"/g, '"');
  if (!value)
    throw new Error(
      'CRON_SECRET is missing from bruno/.env: run `bun run bruno:env`.',
    );
  return value;
}

async function createUser(sql: SQL, label: string): Promise<string> {
  const id = crypto.randomUUID();
  // Usernames are 3 to 20 characters.
  const tag = `${label}_${id.slice(0, 8)}`;
  await sql`
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated',
      ${`${tag}@verify.local`}, '', now(), '{}'::jsonb,
      ${{ username: tag }}::jsonb, now(), now(), '', '', '', ''
    )`;
  return id;
}

async function removeUsers(sql: SQL, ids: string[]) {
  if (ids.length === 0) return;
  await sql`DELETE FROM internal.account_closures WHERE user_id IN ${sql(ids)}`;
  await sql`DELETE FROM auth.users WHERE id IN ${sql(ids)}`;
}

async function closeAsService(sql: SQL, userId: string): Promise<string> {
  return await sql.begin(async (tx) => {
    await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
    await tx`SET LOCAL ROLE service_role`;
    const [row] = await tx`SELECT public.fn_close_account(${userId}) AS result`;
    return (row.result as { status: string }).status;
  });
}

async function closure(sql: SQL, userId: string) {
  const [row] = await sql`
    SELECT stripe_customer_cleanup, stripe_account_cleanup, storage_cleanup, attempts, last_error
    FROM internal.account_closures WHERE user_id = ${userId}`;
  return row as Record<string, unknown> | undefined;
}

async function runWorker(apiUrl: string, secret: string) {
  const response = await fetch(
    `${apiUrl}/functions/v1/account-closure-cleanup`,
    {
      method: 'POST',
      headers: { 'x-cron-secret': secret, 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  const text = await response.text();
  assert.equal(
    response.status,
    200,
    `worker answered ${response.status} ${text.slice(0, 200)}`,
  );
  return JSON.parse(text) as WorkerResult;
}

/** A closed account whose Storage step failed long ago is retried and finished. */
async function retriesFailedClosure(sql: SQL, apiUrl: string, secret: string) {
  const name =
    'the worker claims an idle failed closure, counts one attempt and records the Storage step';
  const created: string[] = [];
  try {
    const userId = await createUser(sql, 'acc_retry');
    created.push(userId);
    assert.equal(await closeAsService(sql, userId), 'closed');
    // Left like a delete-account request whose Storage step failed three attempts ago.
    await sql`
      UPDATE internal.account_closures
      SET storage_cleanup = 'failed', last_error = 'storage:error', attempts = 3,
          updated_at = '2020-01-01T00:00:00Z'
      WHERE user_id = ${userId}`;
    const result = await runWorker(apiUrl, secret);
    assert.ok(result.claimed >= 1, JSON.stringify(result));
    assert.equal(result.completed, result.claimed, JSON.stringify(result));
    assert.equal(result.failed, 0, JSON.stringify(result));
    assert.equal(result.invalid, 0, JSON.stringify(result));
    assert.deepEqual(await closure(sql, userId), {
      stripe_customer_cleanup: 'not_needed',
      stripe_account_cleanup: 'not_needed',
      storage_cleanup: 'done',
      attempts: 4,
      last_error: null,
    });
    console.log(`PASS ${name}`);
    return 0;
  } catch (error) {
    console.log(`FAIL ${name}\n  ${(error as Error).message}`);
    return 1;
  } finally {
    await removeUsers(sql, created).catch(() => undefined);
  }
}

/** A closure at the attempt cap is left alone and reported. */
async function reportsCappedClosure(sql: SQL, apiUrl: string, secret: string) {
  const name =
    'the worker leaves a closure at the attempt cap unclaimed and lists it as capped';
  const created: string[] = [];
  try {
    const userId = await createUser(sql, 'acc_capped');
    created.push(userId);
    await sql`
      INSERT INTO internal.account_closures (
        user_id, stripe_customer_cleanup, stripe_account_cleanup, storage_cleanup,
        attempts, last_error, updated_at
      ) VALUES (
        ${userId}, 'not_needed', 'not_needed', 'failed', ${MAX_ATTEMPTS}, 'storage:error',
        '2020-01-01T00:00:00Z'
      )`;
    const result = await runWorker(apiUrl, secret);
    assert.ok(
      result.capped.some(
        (entry) => entry.user_id === userId && entry.attempts === MAX_ATTEMPTS,
      ),
      JSON.stringify(result.capped),
    );
    assert.deepEqual(await closure(sql, userId), {
      stripe_customer_cleanup: 'not_needed',
      stripe_account_cleanup: 'not_needed',
      storage_cleanup: 'failed',
      attempts: MAX_ATTEMPTS,
      last_error: 'storage:error',
    });
    console.log(`PASS ${name}`);
    return 0;
  } catch (error) {
    console.log(`FAIL ${name}\n  ${(error as Error).message}`);
    return 1;
  } finally {
    await removeUsers(sql, created).catch(() => undefined);
  }
}

async function run() {
  const status = stackStatus();
  const dbUrl = requireLocal(
    process.env.SELENE_LOCAL_DB_URL ?? status.DB_URL ?? '',
    'database',
  );
  const apiUrl = requireLocal(status.API_URL ?? '', 'API');
  const secret = cronSecret();
  const sql = new SQL(dbUrl, { max: 2, connectionTimeout: 5 });
  let failed = 0;
  try {
    failed += await retriesFailedClosure(sql, apiUrl, secret);
    failed += await reportsCappedClosure(sql, apiUrl, secret);
  } finally {
    await sql.close();
  }
  const total = 2;
  console.log(`${total - failed} pass, ${failed} fail`);
  if (failed) process.exit(1);
}

if (process.argv.includes('--help')) console.log(help);
else await run();
