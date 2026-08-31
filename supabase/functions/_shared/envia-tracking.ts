export type ShipmentTrackingEventType =
  | 'created'
  | 'information'
  | 'in_transit'
  | 'delivered'
  | 'exception'
  | 'returned';

export type ShipmentStatusTransition = 'shipped' | 'delivered' | null;

export interface NormalizedEnviaTrackingStatus {
  eventType: ShipmentTrackingEventType;
  shipmentTransition: ShipmentStatusTransition;
}

const ledgerOnlyInformation: NormalizedEnviaTrackingStatus = {
  eventType: 'information',
  shipmentTransition: null,
};

const statusMappings: Readonly<Record<string, NormalizedEnviaTrackingStatus>> =
  {
    created: { eventType: 'created', shipmentTransition: null },
    shipped: { eventType: 'in_transit', shipmentTransition: 'shipped' },
    delivered: { eventType: 'delivered', shipmentTransition: 'delivered' },
    canceled: ledgerOnlyInformation,
    information: ledgerOnlyInformation,
    'n/a': ledgerOnlyInformation,
    pending: ledgerOnlyInformation,
    'picked up': { eventType: 'in_transit', shipmentTransition: 'shipped' },
    'out for delivery': {
      eventType: 'in_transit',
      shipmentTransition: 'shipped',
    },
    lost: { eventType: 'exception', shipmentTransition: null },
    returned: { eventType: 'returned', shipmentTransition: null },
    'pickup at office': ledgerOnlyInformation,
    'delivered at origin': { eventType: 'returned', shipmentTransition: null },
    damaged: { eventType: 'exception', shipmentTransition: null },
    redirected: ledgerOnlyInformation,
    'out for pickup': {
      eventType: 'in_transit',
      shipmentTransition: 'shipped',
    },
    '1 delivery attempt': { eventType: 'exception', shipmentTransition: null },
    '2 delivery attempts': { eventType: 'exception', shipmentTransition: null },
    '3 delivery attempts': { eventType: 'exception', shipmentTransition: null },
    'return problem': { eventType: 'exception', shipmentTransition: null },
    'address error': { eventType: 'exception', shipmentTransition: null },
    undeliverable: { eventType: 'exception', shipmentTransition: null },
    delayed: { eventType: 'exception', shipmentTransition: null },
    rejected: { eventType: 'exception', shipmentTransition: null },
    '1 pickup attempt': ledgerOnlyInformation,
    'partially shipped': ledgerOnlyInformation,
    'partially delivered': ledgerOnlyInformation,
    'delivery attempt': { eventType: 'exception', shipmentTransition: null },
  };

const normalizeStatusKey = (status: string): string =>
  status.trim().replace(/\s+/g, ' ').toLowerCase();

export function normalizeEnviaTrackingStatus(
  status: string,
): NormalizedEnviaTrackingStatus {
  return statusMappings[normalizeStatusKey(status)] ?? ledgerOnlyInformation;
}

export function resolveEnviaTrackingUrl(
  mode: string,
  trackingNumber: string,
): string | null {
  const baseUrl =
    mode === 'production'
      ? 'https://envia.com'
      : mode === 'sandbox'
        ? 'https://test.envia.com'
        : null;

  return baseUrl
    ? `${baseUrl}/rastreo?label=${encodeURIComponent(
        trackingNumber,
      )}&cntry_code=mx`
    : null;
}
