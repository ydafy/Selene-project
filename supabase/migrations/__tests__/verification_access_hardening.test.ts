import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the verification bucket and admin view hardening. These
 * tests read SQL text; `supabase db reset` plus the Bruno requests in
 * bruno/verification prove the SQL runs and the access per role.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_verification_access_hardening.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_verification_access_hardening.sql, found ${files.length}`,
    );
  }
  return normalize(readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8'));
};

const canonical = (...parts: string[]): string =>
  normalize(readFileSync(join(QUERIES_DIR, ...parts), 'utf8'));

const OWNER_EXISTS =
  "EXISTS ( SELECT 1 FROM public.products p WHERE p.id::text = (storage.foldername(objects.name))[1] AND p.seller_id = (SELECT auth.uid()) )";

describe('verification bucket policies', () => {
  const sql = findMigration();

  test('drops the permissive policies by exact name', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Allow Select Own Files 1ahc6qj_0" ON storage.objects;');
    expect(sql).toContain('DROP POLICY IF EXISTS "Allow Uploads 1ahc6qj_0" ON storage.objects;');
  });

  test('SELECT is admin or the listing owner, authenticated only', () => {
    expect(sql).toContain(
      `CREATE POLICY "Allow Select Own Files 1ahc6qj_0" ON storage.objects FOR SELECT TO authenticated USING ( bucket_id = 'verification' AND ( public.is_admin() OR ${OWNER_EXISTS} ) );`,
    );
  });

  test('INSERT is the listing owner only, authenticated only', () => {
    expect(sql).toContain(
      `CREATE POLICY "Allow Uploads 1ahc6qj_0" ON storage.objects FOR INSERT TO authenticated WITH CHECK ( bucket_id = 'verification' AND ${OWNER_EXISTS} );`,
    );
  });

  test('grants nothing to anon or public and leaves UPDATE/DELETE alone', () => {
    expect(sql).not.toMatch(/CREATE POLICY[^;]*TO (anon|public)/i);
    expect(sql).not.toMatch(/FOR (UPDATE|DELETE|ALL)/i);
  });

  test('migration contains the canonical policies', () => {
    expect(sql).toContain(canonical('rls', 'verification_bucket_policies.sql'));
  });
});

describe.each([
  ['admin_product_queue_view', 'admin_product_queue_view.sql', 'created_at'],
  ['seller_trust_stats', 'seller_trust_stats.sql', 'seller_id'],
])('%s', (view, file) => {
  const sql = findMigration();

  test('stays security_invoker and only returns rows to admins', () => {
    expect(sql).toMatch(
      new RegExp(
        `CREATE OR REPLACE VIEW public[.]${view} WITH [(]security_invoker = true[)] AS[^;]*public[.]is_admin[(][)]`,
      ),
    );
  });

  test('revokes everything from anon and keeps authenticated SELECT', () => {
    expect(sql).toContain(`REVOKE ALL ON public.${view} FROM anon;`);
    expect(sql).toContain(`REVOKE ALL ON public.${view} FROM PUBLIC;`);
    // authenticated had GRANT ALL; admins only need to read these views.
    expect(sql).toContain(`REVOKE ALL ON public.${view} FROM authenticated;`);
    expect(sql).toContain(`GRANT SELECT ON public.${view} TO authenticated;`);
  });

  test('migration contains the canonical definition', () => {
    expect(sql).toContain(canonical('admin', file));
  });
});
