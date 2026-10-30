import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { ShippingQuoteRequestSchema } from './request-schema.ts';

// Prettier may re-wrap the source files read below and rewrite double quotes
// to single quotes; compare without layout or quote style.
const compact = (source: string) =>
  source
    .replace(/\s+/g, ' ')
    .replace(/([([{]) /g, '$1')
    .replace(/ ([)\]}])/g, '$1')
    .replace(/,([)\]}])/g, '$1')
    .replace(/ \./g, '.')
    .replace(/"/g, "'");

const validRequest = {
  originZip: '06500',
  packageId: 'gpu-medium',
  price: 4500,
};

describe('get-shipping-quote request schema', () => {
  it('accepts a quote request and trims the package id', () => {
    const result = ShippingQuoteRequestSchema.safeParse({
      ...validRequest,
      packageId: '  gpu-medium  ',
      destinationZip: '64000',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      ...validRequest,
      destinationZip: '64000',
    });
  });

  it('rejects malformed zip codes and non-positive or infinite prices', () => {
    for (const invalid of [
      { ...validRequest, originZip: '065' },
      { ...validRequest, destinationZip: 'abcde' },
      { ...validRequest, price: 0 },
      { ...validRequest, price: Number.POSITIVE_INFINITY },
      { ...validRequest, packageId: '   ' },
    ]) {
      expect(ShippingQuoteRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('is the schema the entrypoint validates with', () => {
    const source = compact(
      readFileSync(new URL('./index.ts', import.meta.url), 'utf8'),
    );

    expect(source).toContain(compact('from "./request-schema.ts"'));
    expect(source).toContain(
      compact('ShippingQuoteRequestSchema.safeParse(body)'),
    );
  });
});
