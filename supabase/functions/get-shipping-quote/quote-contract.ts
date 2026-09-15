const PAQUETEXPRESS = 'paquetexpress';
const GROUND = 'ground';
const MXN = 'mxn';

type ProviderRate = Record<string, unknown>;

export type ShippingQuoteRate = {
  carrier: string;
  service: string;
  price: number;
  estimated_days: number;
};

const normalizeIdentity = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized || null;
};

const readPrice = (rate: ProviderRate): number | null => {
  const source = rate.totalPrice ?? rate.total_price ?? rate.price;
  if (typeof source !== 'string' && typeof source !== 'number') return null;

  const price = Number(source);
  return Number.isFinite(price) && price >= 0 ? price : null;
};

/**
 * Enforces the publication-rate policy before any seller economics are derived.
 * A mixed response is rejected rather than silently selecting a favorable rate.
 */
export function selectPaquetexpressGroundRate(
  rates: unknown,
  _originZip: string,
): ShippingQuoteRate {
  if (!Array.isArray(rates) || rates.length !== 1) {
    throw new Error('UNSUPPORTED_SHIPPING_RATE');
  }

  const candidate = rates[0];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('UNSUPPORTED_SHIPPING_RATE');
  }

  const rate = candidate as ProviderRate;
  const price = readPrice(rate);
  if (
    normalizeIdentity(rate.carrier) !== PAQUETEXPRESS ||
    normalizeIdentity(rate.service) !== GROUND ||
    normalizeIdentity(rate.currency) !== MXN ||
    price === null
  ) {
    throw new Error('UNSUPPORTED_SHIPPING_RATE');
  }

  return {
    carrier: rate.carrier as string,
    service: rate.service as string,
    price,
    estimated_days: 3,
  };
}
