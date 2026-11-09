// source-text: the migration must install the canonical bodies; pgTAP proves the path rule runs
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards: the return evidence RPCs accept only object paths of the caller's
 * own uploads for the dispute's order. `supabase db reset` and pgTAP prove the SQL runs.
 */

const root = join(import.meta.dir, '..', '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const buyer = () =>
  read('supabase/queries/return/fn_buyer_submit_return_evidence.sql');
const seller = () =>
  read('supabase/queries/return/fn_seller_submit_return_evidence.sql');
const migrationName = readdirSync(join(root, 'supabase/migrations')).find(
  (name) => name.endsWith('_evidence_object_paths.sql'),
);
const migration = () => read(`supabase/migrations/${migrationName}`);
const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const FILE_NAME = "/[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$'";

describe('buyer return evidence paths', () => {
  it('refuses a call without a caller identity', () => {
    expect(buyer()).toContain(
      "IF v_auth_user_id IS NULL THEN RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN; END IF;",
    );
  });

  it("accepts only the caller's returns folder for the dispute's order, before the update", () => {
    const text = buyer();
    expect(text).toContain(
      'SELECT buyer_id, status, order_id INTO v_buyer_id, v_status, v_order_id',
    );
    expect(collapse(text)).toContain(
      collapse(`FROM unnest(p_images) AS evidence(path)
        WHERE (evidence.path ~ ('^returns/' || v_order_id::text || '/' || v_auth_user_id::text || '${FILE_NAME})
               AND strpos(evidence.path, '..') = 0) IS NOT TRUE`),
    );
    const rejection = text.indexOf("'INVALID_EVIDENCE_PATH'");
    expect(rejection).toBeGreaterThan(-1);
    expect(rejection).toBeLessThan(text.indexOf('UPDATE public.disputes'));
  });
});

describe('seller return evidence paths', () => {
  it("accepts only the caller's disputes folder for the order, for every image and the video", () => {
    const text = seller();
    expect(collapse(text)).toContain(
      collapse(`FROM unnest(p_images || p_video_url) AS evidence(path)
        WHERE (evidence.path ~ ('^disputes/' || v_order_id::text || '/' || v_auth_user_id::text || '${FILE_NAME})
               AND strpos(evidence.path, '..') = 0) IS NOT TRUE`),
    );
    const rejection = text.indexOf("'INVALID_EVIDENCE_PATH'");
    expect(rejection).toBeGreaterThan(
      text.indexOf("'INVALID_DISPUTE_RELATIONSHIP'"),
    );
    expect(rejection).toBeLessThan(text.indexOf('UPDATE public.disputes'));
  });
});

describe('evidence object paths migration', () => {
  it('installs both canonical bodies and keeps owners and grants', () => {
    expect(migrationName).toBeDefined();
    const sql = migration();
    const bodies = [...sql.matchAll(/AS \$\$\n([\s\S]*?)\n\$\$;/g)].map(
      (match) => match[1],
    );
    expect(bodies.map(collapse)).toEqual([
      collapse(buyer()),
      collapse(seller()),
    ]);
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "public"."fn_buyer_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[])',
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "public"."fn_seller_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[], "p_video_url" "text" DEFAULT NULL::"text")',
    );
    expect(sql.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(GRANT|REVOKE|ALTER FUNCTION)\b/);
    expect(sql).toContain('BEGIN;');
    expect(sql.trimEnd()).toEndWith('COMMIT;');
  });
});
