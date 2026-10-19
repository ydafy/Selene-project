import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePreparingBox } from '../../core/utils/preparing-box';
import en from '../../core/i18n/locales/en/orders.json';
import es from '../../core/i18n/locales/es/orders.json';

const presets = {
  gpu_1: { category: 'GPU', label: 'Medium box', length: 40, width: 30, height: 15, weight: 2 },
  mobo_1: { category: 'Motherboard', label: 'Standard box', length: 50, width: 40, height: 20, weight: 4 },
};

describe('preparing box resolution', () => {
  it('shows the product preset when it is usable', () => {
    expect(resolvePreparingBox('gpu_1', presets)).toEqual({
      status: 'preset',
      preset: presets.gpu_1,
    });
  });

  it('shows the standard mobo_1 box when the product preset is missing or invalid', () => {
    for (const key of ['deleted_preset', null]) {
      expect(resolvePreparingBox(key, presets)).toEqual({
        status: 'fallback',
        preset: presets.mobo_1,
      });
    }
    expect(
      resolvePreparingBox('gpu_1', {
        ...presets,
        gpu_1: { ...presets.gpu_1, weight: 0 },
      }),
    ).toEqual({ status: 'fallback', preset: presets.mobo_1 });
  });

  it('blocks only after presets loaded without any usable box', () => {
    expect(resolvePreparingBox('gpu_1', undefined)).toEqual({ status: 'loading' });
    expect(resolvePreparingBox('deleted_preset', { gpu_1: presets.gpu_1 })).toEqual({
      status: 'unavailable',
    });
  });

  it('explains the fallback and the blocked state in both locales', () => {
    for (const locale of [en, es]) {
      expect(locale.prepare.boxFallbackNote).toBeString();
      expect(locale.prepare.statusBoxUnavailable).toBeString();
    }
    expect(es.prepare.boxFallbackNote).toBe(
      'Este producto no tiene caja asignada; usaremos la caja estándar para la guía.',
    );
    expect(es.prepare.statusBoxUnavailable).toBe(
      'No hay una caja configurada para este envío. Contacta a soporte para continuar.',
    );
  });

  it('blocks generation in the screen when no usable box exists', () => {
    const screen = readFileSync(
      join(import.meta.dir, '../../app/profile/orders/prepare/[id].tsx'),
      'utf8',
    );

    expect(screen).toContain('resolvePreparingBox(presetId, packagePresets)');
    expect(screen.match(/boxBlocked \|\|/g)?.length).toBe(2);
    expect(screen).toContain("t('orders:prepare.statusBoxUnavailable')");
    expect(screen).toContain("t('orders:prepare.boxFallbackNote')");
  });
});
