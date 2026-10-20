import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  import.meta.dir,
  '..',
  '20260828030000_shipment_tracking_foundation.sql',
);

const migrationSql = () => readFileSync(migrationPath, 'utf8');

const trackingEventsPolicy = () => {
  const policy = migrationSql().match(
    /CREATE POLICY "shipment tracking events are visible to participants and admins"[\s\S]*?\);/,
  )?.[0];

  expect(policy).toBeDefined();
  return policy ?? '';
};

describe('shipment tracking event RLS contract', () => {
  it('allows the shipment buyer and seller to read the timeline', () => {
    const policy = trackingEventsPolicy();

    expect(policy).toContain('FOR SELECT TO authenticated');
    expect(policy).toContain('JOIN public.orders o ON o.id = s.order_id');
    expect(policy).toContain('o.buyer_id = auth.uid()');
    expect(policy).toContain('s.seller_id = auth.uid()');
  });

  it('allows admins resolved from profiles_private to read the timeline', () => {
    const policy = trackingEventsPolicy();

    expect(policy).toContain('FROM public.profiles_private pp');
    expect(policy).toContain('pp.id = auth.uid()');
    expect(policy).toContain("pp.role = 'admin'");
  });

  it('denies unrelated authenticated users by requiring a participant or admin match', () => {
    const policy = trackingEventsPolicy().replace(/\s+/g, ' ');

    expect(policy).toContain('EXISTS ( SELECT 1 FROM public.shipments s');
    expect(policy).toContain('OR EXISTS ( SELECT 1 FROM public.profiles_private pp');
    expect(policy).not.toContain('USING (true)');
    expect(policy).not.toContain('USING ( true )');
  });

  it('grants clients only SELECT and defines no client mutation policy', () => {
    const sql = migrationSql();
    const policies = sql.match(/CREATE POLICY[\s\S]*?\);/g) ?? [];

    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.shipment_tracking_events FROM PUBLIC, anon, authenticated',
    );
    expect(sql).toContain(
      'GRANT SELECT ON TABLE public.shipment_tracking_events TO authenticated',
    );

    for (const policy of policies) {
      if (!policy.includes('ON public.shipment_tracking_events')) continue;

      expect(policy).toContain('FOR SELECT TO authenticated');
      expect(policy).not.toContain('FOR INSERT');
      expect(policy).not.toContain('FOR UPDATE');
      expect(policy).not.toContain('FOR DELETE');
      expect(policy).not.toContain('FOR ALL');
    }
  });
});
