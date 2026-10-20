import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(
    join(import.meta.dir, '..', '..', '..', relativePath),
    'utf8',
  ).replace(/\s+/g, ' ');

describe('shipment cancel source guards', () => {
  it('wires every caller through the shared claim/frozen-start orchestration', () => {
    for (const handler of [
      'cancel-order',
      'auto-cancel-orders',
      'auto-cancel-preparing',
    ]) {
      const source = read(`supabase/functions/${handler}/index.ts`);
      expect(source).toContain('runShipmentCancellation(');
      expect(source).toContain('fn_claim_shipment_cancellation');
      expect(source).toContain('fn_start_shipment_cancellation_refund');
      expect(source).not.toContain('`auto_cancel_${');
      expect(source).not.toContain('`auto_cancel_preparing_${');
      expect(source).not.toContain("=== 'charge_already_refunded'");
    }
    const orchestration = read(
      'supabase/functions/_shared/shipment-cancellation.ts',
    );
    expect(orchestration.indexOf('await ports.claim(')).toBeLessThan(
      orchestration.indexOf('await ports.prepare('),
    );
    expect(orchestration.indexOf('await ports.prepare(')).toBeLessThan(
      orchestration.indexOf('await ports.start('),
    );
    expect(orchestration.indexOf('await ports.start(')).toBeLessThan(
      orchestration.indexOf('await ports.refund('),
    );
    expect(orchestration.indexOf('await ports.refund(')).toBeLessThan(
      orchestration.indexOf('await ports.recordRefund('),
    );
    expect(orchestration.indexOf('await ports.recordRefund(')).toBeLessThan(
      orchestration.indexOf('await ports.complete('),
    );
    expect(orchestration).toContain("recorded.refund_status !== 'succeeded'");
  });
  it('uses the service-role RPC path after refund in cancel-order', () => {
    const indexTs = read('supabase/functions/cancel-order/index.ts');

    expect(indexTs).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(indexTs).not.toContain('SUPABASE_ANON_KEY');
    expect(indexTs).not.toContain('supabaseActor');
    expect(indexTs).toContain('fn_cancel_shipment');
    expect(indexTs).toContain('actual_stripe_fee_cents');
    expect(indexTs).toContain('stripe_fee_reconciled_at');
    expect(indexTs).toContain('balance_transaction');
  });

  it('does not enable reverse_transfer for platform-held auto-cancel refunds', () => {
    const autoCancelOrders = read(
      'supabase/functions/auto-cancel-orders/index.ts',
    );
    const autoCancelPreparing = read(
      'supabase/functions/auto-cancel-preparing/index.ts',
    );

    expect(autoCancelOrders).not.toContain('reverse_transfer = true');
    expect(autoCancelPreparing).not.toContain('reverse_transfer = true');
  });

  it('routes auto-cancel through the refund safety gate before fn_cancel_shipment', () => {
    const autoCancelOrders = read(
      'supabase/functions/auto-cancel-orders/index.ts',
    );
    const autoCancelPreparing = read(
      'supabase/functions/auto-cancel-preparing/index.ts',
    );
    const safetyGate = read('supabase/functions/_shared/auto-cancel-safety.ts');

    expect(autoCancelOrders).toContain(
      'resolveAutoCancelShipmentCancellationGate',
    );
    expect(autoCancelPreparing).toContain(
      'resolveAutoCancelShipmentCancellationGate',
    );
    expect(autoCancelOrders).toContain('continue;');
    expect(autoCancelPreparing).toContain('continue;');
    expect(safetyGate).toContain('AUTO_CANCEL_MISSING_PAYMENT_INTENT');
    expect(safetyGate).toContain('AUTO_CANCEL_INVALID_REFUND_AMOUNT');
    expect(autoCancelOrders).toContain('p_cancellation_loss_cents');
    expect(autoCancelPreparing).toContain('p_cancellation_loss_cents');
    expect(autoCancelOrders).toContain('seguroShareCents');
    expect(autoCancelPreparing).toContain('seguroShareCents');
    const orchestration = read(
      'supabase/functions/_shared/shipment-cancellation.ts',
    );
    expect(orchestration).toContain('seguro_share_cents');
  });
});
