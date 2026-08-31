import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');

const read = (relPath: string) =>
  readFileSync(join(FRONTEND, relPath), 'utf8').replace(/\s+/g, ' ');

describe('role-aware orders list routing', () => {
  const index = read('app/profile/orders/index.tsx');

  it('delegates buyer and seller navigation to the shared resolver', () => {
    expect(index).toContain("from './order-view-routing'");
    expect(index).toContain('resolveRoleAwareOrderView(');
    expect(index).toContain('router.push(view.href as Href)');
  });

  it('does not navigate when the resolver marks the order unavailable', () => {
    expect(index).toContain("if (view.kind === 'unavailable') return;");
  });
});

describe('role-aware order summary isolation', () => {
  const summary = read('app/profile/orders/summary/[id].tsx');

  it('uses the shared resolver and redirects non-summary views to their canonical target', () => {
    expect(summary).toContain("from '../order-view-routing'");
    expect(summary).toContain('resolveRoleAwareOrderView(');
    expect(summary).toContain("view.kind !== 'summary'");
    expect(summary).toContain('router.replace(view.href as Href)');
  });

  it('projects shipment cards, counts, and seller totals through visible shipment ids', () => {
    expect(summary).toContain('const visibleShipments = shipmentsSource.filter(');
    expect(summary).toContain('view.visibleShipmentIds.includes(shipment.id)');
    expect(summary).toContain('visibleShipments.reduce(');
    expect(summary).toContain('const orderCount = visibleShipments.length;');
    expect(summary).toContain('visibleShipments.map((shipment) =>');
  });
});

describe('shipment detail identity guards', () => {
  const detail = read('app/profile/orders/[id].tsx');

  it('normalizes the addressed shipment id and delegates access to the resolver', () => {
    expect(detail).toContain("from './order-view-routing'");
    expect(detail).toContain('const shipmentId = Array.isArray(shipment_id)');
    expect(detail).toContain('resolveRoleAwareOrderView(');
    expect(detail).not.toContain('?? source[0]');
  });

  it('redirects missing shipment ids and renders a safe state for invalid or unowned ids', () => {
    expect(detail).toContain("from '../../../components/features/orders/ShipmentNotFoundState'");
    expect(detail).toContain("if (!shipmentId && orderView.kind !== 'unavailable')");
    expect(detail).toContain('<ShipmentNotFoundState');
  });
});
