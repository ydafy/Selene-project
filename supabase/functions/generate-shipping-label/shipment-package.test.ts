import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const {
  declaredContentForCategories,
  FALLBACK_PACKAGE_PRESET,
  resolveShipmentPackage,
} = await import('./shipment-package.ts');

const presets = {
  gpu_1: { length: 40, width: 30, height: 15, weight: 2, category: 'GPU' },
  ram_1: { length: 20, width: 15, height: 5, weight: 0.5, category: 'RAM' },
  mobo_1: { length: 50, width: 40, height: 20, weight: 4, category: 'Motherboard' },
};

describe('declared label content', () => {
  it('declares each known category with a generic Spanish label', () => {
    expect(declaredContentForCategories(['GPU'])).toBe('Tarjeta de video');
    expect(declaredContentForCategories(['CPU'])).toBe('Procesador');
    expect(declaredContentForCategories(['Motherboard'])).toBe('Tarjeta madre');
    expect(declaredContentForCategories(['RAM'])).toBe('Memoria RAM');
  });

  it('falls back to a generic component label for unknown or missing categories', () => {
    expect(declaredContentForCategories(['Monitor'])).toBe(
      'Componente de computadora',
    );
    expect(declaredContentForCategories([])).toBe('Componente de computadora');
  });

  it('lists distinct labels once when a shipment holds several items', () => {
    expect(declaredContentForCategories(['GPU', 'RAM', 'GPU'])).toBe(
      'Tarjeta de video, Memoria RAM',
    );
  });

  it('declares the category instead of order identifiers in the Envia payload', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('Hardware: ${shipment.order.id');
    expect(source).toContain('content: declaredContentForCategories(');
    expect(source).toContain('product:products(package_preset, category)');
  });
});

describe('shipment package dimensions', () => {
  it('uses the configured preset of every item unchanged', () => {
    expect(resolveShipmentPackage(['gpu_1'], presets)).toEqual({
      length: 40,
      width: 30,
      height: 15,
      weight: 2,
      fallbackPresetKeys: [],
    });
    expect(resolveShipmentPackage(['gpu_1', 'ram_1'], presets)).toEqual({
      length: 40,
      width: 30,
      height: 20,
      weight: 2.5,
      fallbackPresetKeys: [],
    });
  });

  it('uses the mobo_1 preset when an item preset is missing or invalid', () => {
    expect(FALLBACK_PACKAGE_PRESET).toBe('mobo_1');
    for (const key of ['deleted_preset', null, '']) {
      expect(resolveShipmentPackage([key], presets)).toEqual({
        length: 50,
        width: 40,
        height: 20,
        weight: 4,
        fallbackPresetKeys: [String(key)],
      });
    }
    expect(
      resolveShipmentPackage(['broken'], {
        ...presets,
        broken: { length: 0, width: 30, height: 15, weight: 2 },
      })?.fallbackPresetKeys,
    ).toEqual(['broken']);
  });

  it('blocks the label when neither the item preset nor mobo_1 is usable', () => {
    const withoutFallback = { gpu_1: presets.gpu_1, ram_1: presets.ram_1 };

    expect(resolveShipmentPackage(['deleted_preset'], withoutFallback)).toBeNull();
    expect(
      resolveShipmentPackage(['deleted_preset'], {
        ...withoutFallback,
        mobo_1: { length: 50, width: 40, height: 20, weight: Number.NaN },
      }),
    ).toBeNull();
    expect(resolveShipmentPackage([], presets)).toBeNull();
    expect(resolveShipmentPackage(['gpu_1'], null)).toBeNull();
  });

  it('never sends hardcoded dimensions and fails closed before claiming', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    const resolve = source.indexOf('resolveShipmentPackage(');
    const claim = source.indexOf('runLabelClaimOrchestration({');

    expect(source).not.toContain('length: 20, width: 20, height: 15, weight: 1');
    expect(resolve).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(resolve);
    expect(source).toContain("throw new ApiError(422, 'PACKAGE_PRESET_UNAVAILABLE')");
  });
});
