import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const { declaredContentForCategories } = await import('./shipment-package.ts');

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
