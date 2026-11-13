// source-text: the Bruno requests and local specs are the contract; they must not touch tables only RPCs may reach.
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// `service_role` has no privilege on these tables, locally and on the remote
// (migration 20261109083744_local_privilege_parity). All but the first live in
// schema internal: five since 20261113004344_internal_tables_machinery, the
// last two since 20261113034659_internal_tables_money. Only
// SECURITY DEFINER RPCs reach them, so local tooling reads them through an RPC
// or a direct owner connection, never through REST or a supabase-js `.from()`
// call. Edge Functions use `service_role` too, so they must not call `.from()`
// on the internal ones (PostgREST cannot reach schema internal).
const INTERNAL_TABLES = [
  'connect_account_actionability',
  'connect_account_events',
  'connect_payout_events',
  'webhook_deliveries',
  'account_closures',
  'checkout_recovery_shells',
  'stripe_fee_reconciliation_jobs',
];
const RPC_ONLY_TABLES = [
  'shipment_cancellation_operations',
  ...INTERNAL_TABLES,
];

const ROOT_DIR = join(import.meta.dir, '..', '..');
const SCANNED = [
  { dir: 'bruno', file: /\.bru$/ },
  { dir: 'e2e/admin-web-local', file: /\.[cm]?[jt]sx?$/ },
];
const FUNCTIONS_DIR = 'supabase/functions';
const FUNCTIONS_FILE = /\.[cm]?tsx?$/;
const SKIP_DIRS = new Set(['node_modules', '.git']);

const TABLES = RPC_ONLY_TABLES.join('|');
// Matched over the whole file (`\s*` spans newlines), so a `.from(` split across
// lines is caught; the reported line is where the match starts. A quoted table
// name followed by `?` is a REST path a script helper prefixes with `rest/v1/`.
const ACCESS = new RegExp(
  `rest/v1/(?:${TABLES})\\b|\\.from\\(\\s*['"\`](?:public\\.)?(?:${TABLES})['"\`]|['"\`](?:${TABLES})\\?`,
  'g',
);
// Edge Functions: only supabase-js `.from()` on a table in schema internal.
const FUNCTIONS_ACCESS = new RegExp(
  `\\.from\\(\\s*['"\`](?:public\\.)?(?:${INTERNAL_TABLES.join('|')})['"\`]`,
  'g',
);

function findTableAccess(
  files: { path: string; text: string }[],
  pattern: RegExp = ACCESS,
): string[] {
  const offenders: string[] = [];
  for (const { path, text } of files) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      offenders.push(`${path}:${line}`);
    }
  }
  return offenders;
}

const collect = (dir: string, file: RegExp): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : collect(fullPath, file);
    }
    return file.test(entry.name) ? [fullPath] : [];
  });

describe('service_role table access guard (probes)', () => {
  it('reports a Bruno REST read of an RPC-only table', () => {
    expect(
      findTableAccess([
        {
          path: 'bruno/x.bru',
          text: 'get {\n  url: {{baseUrl}}/rest/v1/shipment_cancellation_operations?select=*\n}',
        },
      ]),
    ).toEqual(['bruno/x.bru:2']);
  });

  it('reports a supabase-js .from() on each RPC-only table', () => {
    const files = RPC_ONLY_TABLES.map((table) => ({
      path: `e2e/${table}.ts`,
      text: `await admin.from('${table}').delete();`,
    }));
    expect(findTableAccess(files)).toEqual(
      RPC_ONLY_TABLES.map((table) => `e2e/${table}.ts:1`),
    );
  });

  it('reports a REST path a script helper builds from a quoted table name', () => {
    expect(
      findTableAccess([
        {
          path: 'bruno/h.bru',
          text: [
            'const rest = async (path) => get(baseUrl + "/rest/v1/" + path);',
            'await rest("connect_account_events?select=stripe_event_id");',
            "await rest('connect_account_actionability?stripe_account_id=eq.' + id);",
          ].join('\n'),
        },
      ]),
    ).toEqual(['bruno/h.bru:2', 'bruno/h.bru:3']);
  });

  it('reports a .from() call split across lines', () => {
    expect(
      findTableAccess([
        {
          path: 'e2e/z.ts',
          text: "await db\n  .from(\n    'connect_payout_events',\n  )\n  .delete();",
        },
      ]),
    ).toEqual(['e2e/z.ts:2']);
  });

  it('ignores other tables, RPCs and names that only share a prefix', () => {
    expect(
      findTableAccess([
        {
          path: 'bruno/y.bru',
          text: [
            'url: {{baseUrl}}/rest/v1/shipments?id=eq.1',
            'url: {{baseUrl}}/rest/v1/rpc/fn_get_shipment_cancellation_summary',
            "admin.from('shipment_cancellation_operations_view')",
            'docs: service_role cannot read shipment_cancellation_operations',
            'await rest("connect_account_events_archive?select=id");',
            'await rest("/connect_account_events?select=id");',
          ].join('\n'),
        },
      ]),
    ).toEqual([]);
  });
});

describe('Edge Function internal table access guard (probes)', () => {
  it('reports a supabase-js .from() on each RPC-only table in schema internal', () => {
    const files = INTERNAL_TABLES.map((table) => ({
      path: `supabase/functions/x/${table}.ts`,
      text: `await supabaseAdmin\n  .from(\n    'public.${table}',\n  )\n  .upsert({});`,
    }));
    expect(findTableAccess(files, FUNCTIONS_ACCESS)).toEqual(
      INTERNAL_TABLES.map((table) => `supabase/functions/x/${table}.ts:2`),
    );
  });

  it('ignores public tables, RPC names and table names in strings', () => {
    expect(
      findTableAccess(
        [
          {
            path: 'supabase/functions/y/handler.ts',
            text: [
              "await supabaseAdmin.from('shipment_cancellation_operations').select();",
              "await supabaseAdmin.rpc('fn_enqueue_stripe_fee_reconciliation_job', {});",
              "if (query.table === 'stripe_fee_reconciliation_jobs') return;",
              "await supabaseAdmin.from('checkout_recovery_shells_view').select();",
            ].join('\n'),
          },
        ],
        FUNCTIONS_ACCESS,
      ),
    ).toEqual([]);
  });
});

describe('service_role table access guard', () => {
  it('finds no REST or .from() access to RPC-only tables in Bruno or local specs', () => {
    const files = SCANNED.flatMap(({ dir, file }) =>
      collect(join(ROOT_DIR, dir), file).map((path) => ({
        path: relative(ROOT_DIR, path).replaceAll('\\', '/'),
        text: readFileSync(path, 'utf8'),
      })),
    );
    expect(findTableAccess(files)).toEqual([]);
  });
});

describe('Edge Function internal table access guard', () => {
  it('finds no .from() on a table in schema internal in supabase/functions', () => {
    const files = collect(join(ROOT_DIR, FUNCTIONS_DIR), FUNCTIONS_FILE).map(
      (path) => ({
        path: relative(ROOT_DIR, path).replaceAll('\\', '/'),
        text: readFileSync(path, 'utf8'),
      }),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(findTableAccess(files, FUNCTIONS_ACCESS)).toEqual([]);
  });
});
