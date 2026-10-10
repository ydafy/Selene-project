import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrations = join(import.meta.dir, '..');
const canonical = join(migrations, '..', 'queries', 'payments');
const cases = [
  {
    name: 'fn_begin_payout_create_fence',
    canonical: 'connect_payout_stage_fencing.sql',
    historical: '20260919090000_connect_payout_stage_fencing.sql',
    blob: '077a80d9345a9c12d060c60209266fce7c300233',
    result: 'INTEGER',
  },
  {
    name: 'fn_verify_payout_claim',
    canonical: 'connect_payout_balance_executor.sql',
    historical: '20260920000000_connect_payout_balance_executor_claim.sql',
    blob: '4b041b5e6364dc4e330d30b2d18f3dbf3ad3b6b2',
    result: 'BOOLEAN',
  },
] as const;
const read = (directory: string, file: string): string =>
  readFileSync(join(directory, file), 'utf8');
const rpc = (sql: string, name: string): string =>
  [...sql.matchAll(new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\b[\\s\\S]*?\\$\\$;`, 'gi',
  ))].at(-1)?.[0] ?? '';
const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();
const historicalBlob = (text: string): string => {
  const bytes = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};
const rejection = (sql: string, error: string): string =>
  [...sql.matchAll(/IF\s+([^;]*?)\s+THEN\s+RAISE\s+EXCEPTION\s+'([^']+)';\s*END\s+IF;/gi)]
    .find((match) => match[2] === error)?.[1] ?? '';
// Remove precisely the newly authorized terms, not arbitrary SQL changes.
const withoutAddedGuards = (sql: string, name: string): string => {
  let original = sql.replace(/p_claim_token\s+IS\s+NULL\s+OR\s+/i, '')
    .replace(/\s+OR\s+p_claim_token\s+IS\s+NULL/i, '');
  if (name === 'fn_begin_payout_create_fence') {
    original = original.replace(/p_expected_stage_version\s+IS\s+NULL\s+OR\s+/i, '')
      .replace(/\s+OR\s+p_expected_stage_version\s+IS\s+NULL/i, '');
  }
  return original;
};
const forwardFile = readdirSync(migrations)
  .filter((file) => file.endsWith('_reject_null_payout_claim_inputs.sql')).sort().pop();
// Absence must yield an assertion RED, never ENOENT or an import failure.
const forward = forwardFile ? read(migrations, forwardFile) : '';

// Source-backed SQL contracts only. No PostgreSQL execution, lease simulation,
// caller exploitability proof, or JavaScript reimplementation of SQL semantics.
describe('payout claim NULL rejection (source contracts, not DB execution)', () => {
  for (const entry of cases) {
    const current = rpc(read(canonical, entry.canonical), entry.name);
    const previous = rpc(read(migrations, entry.historical), entry.name);
    test(`${entry.name}: NULL caller token rejects in STALE_CLAIM before success/write`, () => {
      expect(current).not.toBe('');
      const branch = rejection(current, 'STALE_CLAIM');
      expect(branch).toMatch(/\bp_claim_token\s+IS\s+NULL\b/i);
      const success = current.search(/UPDATE\s+public\.connect_payout_runs|RETURN\s+TRUE/i);
      expect(success).toBeGreaterThan(current.indexOf(branch));
    });
    test(`${entry.name}: NULL expected version rejects in STAGE_VERSION_CONFLICT`, () => {
      const branch = rejection(current, 'STAGE_VERSION_CONFLICT');
      expect(branch).toMatch(/\bp_expected_stage_version\s+IS\s+NULL\b/i);
      const success = current.search(/UPDATE\s+public\.connect_payout_runs|RETURN\s+TRUE/i);
      expect(success).toBeGreaterThan(current.indexOf(branch));
    });
    test(`${entry.name}: existing stored claim, lease, version and state controls remain`, () => {
      expect(rejection(current, 'STALE_CLAIM')).toMatch(/v_token\s+IS\s+NULL\s+OR\s+v_token\s*<>\s*p_claim_token/i);
      expect(rejection(current, 'CLAIM_LEASE_EXPIRED')).toMatch(/v_expires\s+IS\s+NULL\s+OR\s+v_expires\s*<=\s*now\(\)/i);
      expect(rejection(current, 'STAGE_VERSION_CONFLICT')).toMatch(/v_version\s*<>\s*p_expected_stage_version/i);
      expect(current).toMatch(/WHERE\s+cpr\.id\s*=\s*p_run_id/i);
      expect(current).toMatch(/IF\s+NOT\s+FOUND\s+THEN\s+RAISE\s+EXCEPTION\s+'PAYOUT_RUN_NOT_FOUND'/i);
      if (entry.name === 'fn_begin_payout_create_fence') {
        expect(current).toMatch(/FOR\s+UPDATE/i);
        expect(rejection(current, 'PAYOUT_CREATE_FENCE_CONFLICT')).toMatch(/v_stage\s*<>\s*'awaiting_connected_balance'/i);
        expect(current).toMatch(/SET\s+release_stage\s*=\s*'payout_create_in_progress'/i);
        expect(current).toMatch(/RETURN\s+v_version\s*\+\s*1/i);
      } else {
        expect(current).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/i);
        expect(current).toMatch(/RETURN\s+TRUE/i);
      }
    });
    test(`${entry.name}: only authorized NULL terms differ from authoritative historical RPC`, () => {
      expect(previous).not.toBe('');
      expect(normalize(withoutAddedGuards(current, entry.name))).toBe(normalize(previous));
    });
    test(`${entry.historical}: Git-normalized historical text remains untouched`, () => {
      expect(historicalBlob(read(migrations, entry.historical))).toBe(entry.blob);
    });
  }

  test('historical blob normalization treats LF and CRLF equivalently with UTF-8 byte lengths', () => {
    const lf = '-- lease résumé\nSELECT TRUE;\n';
    const bytes = Buffer.from(lf, 'utf8');
    const expected = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    expect(historicalBlob(lf)).toBe(expected);
    expect(historicalBlob(lf.replace(/\n/g, '\r\n'))).toBe(expected);
  });

  test('new forward migration exists and replaces exactly the two authorized RPCs', () => {
    expect(forward, 'Missing forward *_reject_null_payout_claim_inputs.sql').not.toBe('');
    expect([...forward.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/gi)]
      .map((match) => match[1]).sort()).toEqual(cases.map((entry) => entry.name).sort());
    expect(forward).not.toMatch(/\b(?:ALTER\s+TABLE|CREATE\s+TABLE|DROP|CREATE\s+POLICY)\b/i);
  });
  for (const entry of cases) {
    test(`${entry.name}: forward definition matches canonical and preserves signature/security`, () => {
      const replacement = rpc(forward, entry.name);
      expect(replacement, 'Missing forward RPC definition').not.toBe('');
      expect(normalize(replacement)).toBe(normalize(rpc(read(canonical, entry.canonical), entry.name)));
      expect(replacement).toMatch(new RegExp(
        `\\(\\s*p_run_id UUID,\\s*p_claim_token TEXT,\\s*p_expected_stage_version INTEGER\\s*\\)\\s*RETURNS ${entry.result}\\s*LANGUAGE plpgsql\\s*SECURITY DEFINER\\s*SET search_path = public`, 'i',
      ));
      expect(normalize(withoutAddedGuards(replacement, entry.name)))
        .toBe(normalize(rpc(read(migrations, entry.historical), entry.name)));
    });
    test(`${entry.name}: forward execution remains service-role-only`, () => {
      const target = `public\\.${entry.name}(?:\\s*\\(\\s*UUID\\s*,\\s*TEXT\\s*,\\s*INTEGER\\s*\\))?`;
      expect(forward).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${target} FROM PUBLIC;`, 'i'));
      expect(forward).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${target} FROM anon, authenticated;`, 'i'));
      expect(forward).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${target} TO service_role;`, 'i'));
    });
  }
  test('forward migration grants no additional roles or unrelated RPC privileges', () => {
    expect(forward, 'Missing forward privileges').not.toBe('');
    const privileges = [...forward.matchAll(/(?:GRANT|REVOKE)\s+EXECUTE\s+ON\s+FUNCTION\s+public\.(\w+)[^;]*;/gi)];
    expect(privileges).toHaveLength(6);
    for (const privilege of privileges) {
      expect(cases.map((entry) => entry.name) as readonly string[]).toContain(privilege[1]);
      expect(privilege[0]).toMatch(/(?:FROM PUBLIC|FROM anon, authenticated|TO service_role);$/i);
    }
    expect(forward).not.toMatch(/GRANT\s+[^;]*\s+TO\s+(?:PUBLIC|anon|authenticated)\b/i);
  });
});
