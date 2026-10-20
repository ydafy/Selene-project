import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

describe('tracking environment separation contract', () => {
  it('selects an Envia webhook secret exclusively from the active server environment', () => {
    const webhook = read('supabase/functions/envia-webhook/index.ts');

    expect(webhook).toContain("const mode = Deno.env.get('ENVIA_MODE') ?? 'sandbox';");
    expect(webhook).toMatch(
      /mode === 'production'\s*\? Deno\.env\.get\('ENVIA_WEBHOOK_SECRET_PROD'\)\s*:\s*Deno\.env\.get\('ENVIA_WEBHOOK_SECRET_SANDBOX'\)/,
    );
    expect(webhook).not.toContain("Deno.env.get('ENVIA_WEBHOOK_SECRET')");
  });

  it('resolves external tracking URLs in the authorized server function, not the Expo client', () => {
    const resolver = read('supabase/functions/resolve-shipment-tracking-url/index.ts');
    const handler = read('supabase/functions/resolve-shipment-tracking-url/handler.ts');
    const hook = read('apps/frontend/core/hooks/useShipmentTracking.ts');

    expect(resolver).toContain("import { resolveEnviaTrackingUrl } from '../_shared/envia-tracking.ts';");
    expect(resolver).toContain("Deno.env.get('ENVIA_MODE') ?? 'sandbox'");
    expect(handler).toContain('dependencies.resolveUrl(subject.trackingNumber)');
    expect(hook).toContain("invokeEdge('resolve-shipment-tracking-url', { shipmentId })");
    expect(hook).not.toContain('ENVIA_');
    expect(hook).not.toContain('envia.com');
  });
});
