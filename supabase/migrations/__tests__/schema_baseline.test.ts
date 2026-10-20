import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '..');
const activeMigrations = readdirSync(migrationsDir).filter((name) =>
  /^\d{14}_.+\.sql$/.test(name),
);
const read = (name: string) =>
  readFileSync(join(migrationsDir, name), 'utf8').replace(/\r\n/g, '\n');

describe('schema baseline (SQL structural only)', () => {
  test('the baseline is the oldest active migration', () => {
    expect(activeMigrations.sort()[0]).toBe(
      '20261020100000_remote_schema_baseline.sql',
    );
  });

  test('no active migration carries a secret', () => {
    const secret =
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk_(live|test)_[A-Za-z0-9]|rk_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9]/;
    for (const name of activeMigrations) {
      expect({ name, leaked: secret.test(read(name)) }).toEqual({
        name,
        leaked: false,
      });
    }
  });

  test('the baseline keeps the objects removed for embedding secrets out', () => {
    const baseline = read('20261020100000_remote_schema_baseline.sql');
    expect(baseline).not.toContain('tr_webhook_order_completed');
    expect(baseline).not.toContain('stripe_server');
  });

  test('storage recreates the five buckets and thirteen object policies', () => {
    const storage = read('20261020100001_storage_buckets_and_policies.sql');
    for (const bucket of [
      'Avatars',
      'evidence',
      'products',
      'public-assets',
      'verification',
    ]) {
      expect(storage).toContain(`('${bucket}', '${bucket}',`);
    }
    expect(storage.match(/^CREATE POLICY /gm)).toHaveLength(13);
    expect(storage.match(/^DROP POLICY IF EXISTS /gm)).toHaveLength(13);
    expect(storage).toContain('ON CONFLICT (id) DO NOTHING;');
  });

  test('auth triggers provision profiles for every new auth user', () => {
    const auth = read('20261020100003_auth_user_triggers.sql').replace(
      /\s+/g,
      ' ',
    );
    expect(auth).toContain(
      'CREATE TRIGGER tr_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.fn_on_auth_user_created();',
    );
    expect(auth.match(/CREATE TRIGGER /g)).toHaveLength(3);
    expect(auth.match(/DROP TRIGGER IF EXISTS /g)).toHaveLength(3);
  });

  test('privilege alignment revokes TRUNCATE from API roles on server-only tables', () => {
    const alignment = read(
      '20261020100002_baseline_privilege_alignment.sql',
    ).replace(/\s+/g, ' ');
    expect(alignment).toContain(
      'REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE',
    );
    expect(alignment).toContain('FROM anon, authenticated;');
    expect(alignment).not.toMatch(/\bGRANT\b/);
  });
});
