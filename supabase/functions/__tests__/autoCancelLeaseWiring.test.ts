import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const handlers = [
  { name: 'auto-cancel-orders', job: 'orders', flag: 'auto_cancel_orders_running' },
  { name: 'auto-cancel-preparing', job: 'preparing', flag: 'auto_cancel_preparing_running' },
];

for (const { name, job, flag } of handlers) {
  describe(`${name} lease wiring`, () => {
    const source = readFileSync(
      new URL(`../${name}/index.ts`, import.meta.url),
      'utf8',
    );
    const tryStart = source.indexOf('  try {');
    const acquireAt = source.indexOf(
      `acquireAutoCancelLease(supabaseAdmin, '${job}', log)`,
    );
    const shipmentsQueryAt = source.indexOf(".from('shipments')");
    const loopAt = source.indexOf('for (const [index, shipment] of expiredShipments.entries())');
    const runAt = source.indexOf('const result = await runShipmentCancellation(');
    const finallyAt = source.indexOf('} finally {');

    test('requires the cron secret before building any client', () => {
      const authAt = source.indexOf(
        "isAuthorizedCronRequest(req, Deno.env.get('CRON_SECRET'))",
      );
      expect(source).toContain("from '../_shared/cron-auth.ts'");
      expect(authAt).toBeGreaterThan(0);
      expect(authAt).toBeLessThan(source.indexOf('createClient('));
      expect(authAt).toBeLessThan(source.indexOf('new Stripe('));
      expect(source).toContain("JSON.stringify({ error: 'UNAUTHORIZED' })");
    });

    test('no longer references the global boolean lock', () => {
      expect(source).not.toContain('_running');
      expect(source).not.toContain(flag);
    });

    test('imports the lease helper', () => {
      expect(source).toContain("from '../_shared/auto-cancel-lease.ts'");
      expect(source).toContain('acquireAutoCancelLease');
      expect(source).toContain('releaseAutoCancelLease');
    });

    test('acquires the lease inside try, before querying shipments', () => {
      expect(acquireAt).toBeGreaterThan(tryStart);
      expect(shipmentsQueryAt).toBeGreaterThan(acquireAt);
    });

    test('returns the helper response when the lease is not acquired', () => {
      expect(source).toContain('if (!lease.acquired) return lease.response;');
      expect(source).toContain('leaseId = lease.leaseId;');
    });

    test('releases the lease in a finally block with the right job', () => {
      expect(finallyAt).toBeGreaterThan(0);
      const tail = source.slice(finallyAt);
      expect(tail).toContain(
        `releaseAutoCancelLease(supabaseAdmin, '${job}', leaseId, log)`,
      );
    });

    test('checks the run budget in the shipment loop before cancelling', () => {
      expect(loopAt).toBeGreaterThan(0);
      const budgetAt = source.indexOf('lease.budgetExceeded()', loopAt);
      expect(budgetAt).toBeGreaterThan(loopAt);
      expect(budgetAt).toBeLessThan(runAt);
      expect(source).toContain(
        'Auto-cancel run budget reached; remaining shipments wait for the next run',
      );
    });

    test('reports deferred shipments in the final response', () => {
      const responseAt = source.indexOf('processed: expiredShipments.length');
      expect(responseAt).toBeGreaterThan(0);
      expect(source.slice(responseAt, responseAt + 120)).toContain('deferred');
    });

    test('caught errors still return 500 INTERNAL_ERROR', () => {
      expect(source).toContain("JSON.stringify({ error: 'INTERNAL_ERROR' })");
    });
  });
}
