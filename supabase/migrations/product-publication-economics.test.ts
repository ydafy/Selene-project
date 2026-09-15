import { describe, expect, it } from 'bun:test';

const migrationPath = new URL(
  './20260911000000_product_publication_economics.sql',
  import.meta.url,
);

describe('product publication economics migration', () => {
  it('defines an all-or-nothing publication economics snapshot on products', async () => {
    const sql = (await Bun.file(migrationPath).text()).toLowerCase();

    expect(sql).toContain('publication_shipping_reserve_cents bigint');
    expect(sql).toContain('publication_commission_rate numeric');
    expect(sql).toContain('publication_insurance_rate numeric');
    expect(sql).toContain('product_publication_economics_snapshot_check');
  });

  it('exposes a service-role-only atomic legacy backfill RPC', async () => {
    const sql = (await Bun.file(migrationPath).text()).toLowerCase();

    expect(sql).toContain('backfill_product_publication_economics');
    expect(sql).toContain('revoke all on function public.backfill_product_publication_economics');
    expect(sql).toContain('grant execute on function public.backfill_product_publication_economics');
  });
});
