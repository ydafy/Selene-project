// source-text: the migration files and supabase/seed.sql are the text this guard scans for secrets
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listRepoFiles } from './agent-instructions';
import {
  collectScannedFiles,
  findSecretFiles,
  looksSecret,
} from './migration-credential-scan';

const root = join(import.meta.dir, '..', '..');

// Built by concatenation so no secret-looking literal sits in this file.
const fake = {
  jwt: 'eyJ' + 'abcdefghijkl' + '.' + 'mnopqrstuvwx',
  stripeSecret: 'sk_' + 'live_' + 'Abc123',
  stripeTest: 'sk_' + 'test_' + 'Abc123',
  restricted: 'rk_' + 'test_' + 'Abc123',
  webhook: 'whsec_' + 'Abc123',
  supabase: 'sb_secret_' + 'Abc123',
};

describe('migration secrets (probes)', () => {
  it('flags each secret shape', () => {
    for (const value of Object.values(fake)) {
      expect({ value, flagged: looksSecret(`select '${value}';`) }).toEqual({
        value,
        flagged: true,
      });
    }
  });

  it('ignores prefixes and names that carry no key', () => {
    for (const text of [
      "select 'sk_live_';",
      'vault secret name stripe_webhook_secret',
      "CONNECT_SHIPMENT_SKIPPED_WALLET 'eyJ'",
      'whsec_ and sb_secret_ alone',
    ]) {
      expect({ text, flagged: looksSecret(text) }).toEqual({
        text,
        flagged: false,
      });
    }
  });

  it('scans active and archived migrations and the seed, sorted', () => {
    expect(
      collectScannedFiles([
        'supabase/seed.sql',
        'supabase/migrations/archive/20260101000000_old.sql',
        'supabase/migrations/20261020100000_remote_schema_baseline.sql',
        'supabase/migrations/__tests__/schema_baseline.test.ts',
        'supabase/schemas/public/functions/is_admin.sql',
        'supabase/tests/database/cron_jobs.test.sql',
      ]),
    ).toEqual([
      'supabase/migrations/20261020100000_remote_schema_baseline.sql',
      'supabase/migrations/archive/20260101000000_old.sql',
      'supabase/seed.sql',
    ]);
  });

  it('names every file that carries a secret', () => {
    expect(
      findSecretFiles([
        { path: 'supabase/migrations/a.sql', text: 'select 1;' },
        {
          path: 'supabase/migrations/archive/b.sql',
          text: `create server s options (api_key '${fake.stripeSecret}');`,
        },
        { path: 'supabase/seed.sql', text: `-- ${fake.jwt}` },
      ]),
    ).toEqual(['supabase/migrations/archive/b.sql', 'supabase/seed.sql']);
  });
});

describe('migration secrets (repository)', () => {
  it('no migration or seed file carries a secret', () => {
    const paths = collectScannedFiles(listRepoFiles(root));
    expect(paths).toContain('supabase/seed.sql');
    expect(
      paths.some((path) => path.startsWith('supabase/migrations/archive/')),
    ).toBe(true);
    const files = paths.map((path) => ({
      path,
      text: readFileSync(join(root, path), 'utf8'),
    }));
    expect(findSecretFiles(files)).toEqual([]);
  });
});
