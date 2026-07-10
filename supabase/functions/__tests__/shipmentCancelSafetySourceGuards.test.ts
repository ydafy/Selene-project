import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8').replace(
    /\s+/g,
    ' ',
  );

describe('shipment cancel source guards', () => {
  it('uses the service-role RPC path after refund in cancel-order', () => {
    const indexTs = read('supabase/functions/cancel-order/index.ts');

    expect(indexTs).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(indexTs).not.toContain('SUPABASE_ANON_KEY');
    expect(indexTs).not.toContain('supabaseActor');
    expect(indexTs).toContain("fn_cancel_shipment");
  });

  it('does not enable reverse_transfer for platform-held auto-cancel refunds', () => {
    const autoCancelOrders = read('supabase/functions/auto-cancel-orders/index.ts');
    const autoCancelPreparing = read('supabase/functions/auto-cancel-preparing/index.ts');

    expect(autoCancelOrders).not.toContain('reverse_transfer = true');
    expect(autoCancelPreparing).not.toContain('reverse_transfer = true');
  });

  it('routes auto-cancel through the refund safety gate before fn_cancel_shipment', () => {
    const autoCancelOrders = read('supabase/functions/auto-cancel-orders/index.ts');
    const autoCancelPreparing = read('supabase/functions/auto-cancel-preparing/index.ts');
    const safetyGate = read('supabase/functions/_shared/auto-cancel-safety.ts');

    expect(autoCancelOrders).toContain('resolveAutoCancelShipmentCancellationGate');
    expect(autoCancelPreparing).toContain('resolveAutoCancelShipmentCancellationGate');
    expect(autoCancelOrders).toContain('continue;');
    expect(autoCancelPreparing).toContain('continue;');
    expect(safetyGate).toContain('AUTO_CANCEL_MISSING_PAYMENT_INTENT');
    expect(safetyGate).toContain('AUTO_CANCEL_INVALID_REFUND_AMOUNT');
  });
});
