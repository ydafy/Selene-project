// source-text: the daily schedule, timeout and Vault secret name are declared only in supabase/schemas/_cluster/misc.sql; supabase/tests/database/cron_jobs.test.sql checks invariants and that this job exists
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('purge-old-evidence cron job', () => {
  const root = join(import.meta.dir, '..', '..', '..');

  it('is scheduled daily at 09:00 UTC in the cron schema with its Vault cron secret', () => {
    const schema = readFileSync(
      join(root, 'supabase/schemas/_cluster/misc.sql'),
      'utf8',
    );
    const job = schema
      .split(/;\s*\n/)
      .find((call) =>
        call.includes("schedule_in_database('purge-old-evidence', '0 9 * * *'"),
      );
    expect(job).toBeDefined();
    expect(job).toContain(
      "select internal.fn_track_cron_request(''purge-old-evidence'', net.http_post(",
    );
    expect(job).toContain('/functions/v1/purge-old-evidence');
    expect(job).toContain("name = ''purge_old_evidence_cron_secret''");
    expect(job).toContain('timeout_milliseconds := 120000');
  });
});
