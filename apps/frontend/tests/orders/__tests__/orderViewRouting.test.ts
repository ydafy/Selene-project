import { describe, expect, it } from 'bun:test';

import { resolveRoleAwareOrderView } from '../../../app/profile/orders/order-view-routing';

const order = {
  id: 'order-1',
  buyerId: 'buyer-1',
  shipments: [
    { id: 'shipment-1', sellerId: 'seller-1' },
    { id: 'shipment-2', sellerId: 'seller-2' },
    { id: 'shipment-3', sellerId: 'seller-1' },
  ],
};

describe('resolveRoleAwareOrderView', () => {
  it('routes a buyer with multiple shipments to the summary', () => {
    expect(resolveRoleAwareOrderView(order, 'buyer-1')).toEqual({
      kind: 'summary',
      role: 'buyer',
      visibleShipmentIds: ['shipment-1', 'shipment-2', 'shipment-3'],
      href: '/profile/orders/summary/order-1',
    });
  });

  it('routes a buyer with one shipment directly to that shipment detail', () => {
    const view = resolveRoleAwareOrderView(
      { ...order, shipments: [order.shipments[0]] },
      'buyer-1',
    );

    expect(view).toEqual({
      kind: 'detail',
      role: 'buyer',
      visibleShipmentIds: ['shipment-1'],
      shipmentId: 'shipment-1',
      href: '/profile/orders/order-1?shipment_id=shipment-1',
    });
  });

  it('routes a seller who owns multiple shipments to an isolated summary', () => {
    expect(resolveRoleAwareOrderView(order, 'seller-1')).toEqual({
      kind: 'summary',
      role: 'seller',
      visibleShipmentIds: ['shipment-1', 'shipment-3'],
      href: '/profile/orders/summary/order-1',
    });
  });

  it('routes a seller who owns one shipment directly to that shipment detail', () => {
    expect(resolveRoleAwareOrderView(order, 'seller-2')).toEqual({
      kind: 'detail',
      role: 'seller',
      visibleShipmentIds: ['shipment-2'],
      shipmentId: 'shipment-2',
      href: '/profile/orders/order-1?shipment_id=shipment-2',
    });
  });

  it('returns unavailable for outsiders and orders without visible shipments', () => {
    expect(resolveRoleAwareOrderView(order, 'outsider-1')).toEqual({
      kind: 'unavailable',
      role: 'none',
      visibleShipmentIds: [],
    });
    expect(
      resolveRoleAwareOrderView({ ...order, shipments: [] }, 'buyer-1'),
    ).toEqual({
      kind: 'unavailable',
      role: 'none',
      visibleShipmentIds: [],
    });
  });

  it('uses the canonical role target when a detail link has no shipment id', () => {
    expect(resolveRoleAwareOrderView(order, 'buyer-1', undefined)).toMatchObject({
      kind: 'summary',
      href: '/profile/orders/summary/order-1',
    });
  });

  it('only resolves an addressed detail when the shipment is visible to the viewer', () => {
    expect(
      resolveRoleAwareOrderView(order, 'seller-1', 'shipment-2'),
    ).toEqual({ kind: 'unavailable', role: 'seller', visibleShipmentIds: [] });
    expect(
      resolveRoleAwareOrderView(order, 'buyer-1', 'missing-shipment'),
    ).toEqual({ kind: 'unavailable', role: 'buyer', visibleShipmentIds: [] });
  });

  it('resolves a valid addressed shipment to its canonical detail target', () => {
    expect(
      resolveRoleAwareOrderView(order, 'buyer-1', 'shipment-2'),
    ).toEqual({
      kind: 'detail',
      role: 'buyer',
      visibleShipmentIds: ['shipment-2'],
      shipmentId: 'shipment-2',
      href: '/profile/orders/order-1?shipment_id=shipment-2',
    });
  });
});
