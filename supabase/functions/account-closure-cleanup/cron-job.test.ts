// source-text: the hourly schedule and its Vault secret name are declared only in supabase/schemas/_cluster/misc.sql; supabase/tests/database/cron_jobs.test.sql checks invariants, not this job
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('account-closure-cleanup cron job', () => {
  const root = join(import.meta.dir, '..', '..', '..');

  it('is scheduled hourly in the cron schema with its Vault cron secret', () => {
    const schema = readFileSync(
      join(root, 'supabase/schemas/_cluster/misc.sql'),
      'utf8',
    );
    const job = schema
      .split(/;\s*\n/)
      .find((call) =>
        call.includes(
          "schedule_in_database('account-closure-cleanup', '0 * * * *'",
        ),
      );
    expect(job).toBeDefined();
    expect(job).toContain('/functions/v1/account-closure-cleanup');
    expect(job).toContain("name = ''account_closure_cleanup_cron_secret''");
  });
});
