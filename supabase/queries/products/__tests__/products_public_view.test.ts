import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const migrationName = readdirSync(join(root, 'migrations')).find((f) => f.endsWith('_products_public_view.sql'));

const ALLOWED = [
  'id',
  'seller_id',
  'name',
  'description',
  'price',
  'category',
  'condition',
  'usage',
  'images',
  'specifications',
  'aspect_ratio',
  'status',
  'views',
  'created_at',
  'fts',
];
const HIDDEN = [
  'origin_zip',
  'verification_data',
  'rejection_reason',
  'locked_by',
  'locked_at',
  'publication_commission_rate',
  'publication_insurance_rate',
  'publication_shipping_reserve_cents',
  'status_before_account_hold',
  'shipping_cost',
  'package_preset',
  'shipping_payer',
  'reserved_at',
  'deleted_at',
];

const stripComments = (sql: string) => sql.replace(/--.*$/gm, '');

const files: Record<string, string | undefined> = {
  migration: migrationName && readFileSync(join(root, 'migrations', migrationName), 'utf8'),
  canonical: readFileSync(join(root, 'queries', 'products', 'products_public.sql'), 'utf8'),
};

describe('products_public view', () => {
  it('ships a migration', () => {
    expect(migrationName).toBeDefined();
  });

  for (const [label, raw] of Object.entries(files)) {
    describe(label, () => {
      const sql = stripComments(raw ?? '');
      const selectList = sql.match(/SELECT([\s\S]*?)\bFROM\b/i)?.[1] ?? '';
      const columns = selectList
        .split(',')
        .map((c) => c.trim().replace(/^(p|public\.products)\./, ''))
        .filter(Boolean);

      it('selects exactly the allow-listed columns, in order', () => {
        expect(columns).toEqual(ALLOWED);
      });

      it('never selects a hidden column and never uses SELECT *', () => {
        for (const col of HIDDEN) expect(columns).not.toContain(col);
        expect(sql).not.toMatch(/SELECT\s+(\w+\.)?\*/i);
        expect(sql).not.toMatch(/\.\*/);
      });

      it('runs with the owner rights behind a security barrier', () => {
        expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.products_public\s+WITH \(security_barrier = true\)/i);
        expect(sql).not.toMatch(/security_invoker\s*=\s*true/i);
      });

      it('keeps the public row predicate of products_select_public', () => {
        expect(sql).toMatch(
          /WHERE\s+(\w+\.)?deleted_at IS NULL\s+AND\s+(\w+\.)?status IN \('VERIFIED', 'SOLD', 'PENDING_VERIFICATION', 'IN_REVIEW'\)/,
        );
      });

      it('revokes everything and grants SELECT only to anon, authenticated, service_role', () => {
        expect(sql).toMatch(/REVOKE ALL ON public\.products_public FROM PUBLIC, anon, authenticated;/);
        expect(sql).toMatch(/GRANT SELECT ON public\.products_public TO anon, authenticated, service_role;/);
        expect(sql).not.toMatch(/GRANT\s+(?!SELECT)\w+[^;]*products_public/i);
      });
    });
  }

  it('documents the grant review in the migration', () => {
    expect(files.migration).toMatch(/Grant review/i);
  });

  it('keeps the migration and the canonical body identical', () => {
    const body = (s: string) => stripComments(s).replace(/\s+/g, ' ').trim();
    expect(body(files.migration ?? '')).toBe(body(files.canonical ?? ''));
  });
});
