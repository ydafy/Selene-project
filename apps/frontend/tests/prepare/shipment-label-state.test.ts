import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveShipmentLabelState } from '../../core/utils/shipment-label-state';

const shipment = {
  status: 'paid' as const,
  label_generation_state: 'unclaimed',
  label_url: null,
  tracking_number: null,
};

describe('persisted shipment label state', () => {
  it('wires the same state policy into submission and preserves cached data on read errors', () => {
    const source = readFileSync(
      join(process.cwd(), 'apps/frontend/app/profile/orders/prepare/[id].tsx'),
      'utf8',
    );
    expect(source).toContain(
      'resolveShipmentLabelState(selectedShipment, Boolean(error))',
    );
    expect(source).toContain(
      "const canGenerateLabel = labelState === 'ready' && !isFetching;",
    );
    expect(source.match(/!canGenerateLabel/g)).toHaveLength(2);
    expect(source).toContain('refetch({ cancelRefetch: false })');
    expect(source).toContain('isLabelRecoveryState(labelState)');
    expect(source).not.toContain('if (error || !order)');
  });

  it('localizes every recovery state and both safe actions in English and Spanish', () => {
    for (const locale of ['en', 'es']) {
      const copy = JSON.parse(
        readFileSync(
          join(
            process.cwd(),
            `apps/frontend/core/i18n/locales/${locale}/orders.json`,
          ),
          'utf8',
        ),
      );
      for (const key of [
        'processingTitle',
        'processingBody',
        'reconciliationTitle',
        'reconciliationBody',
        'unavailableTitle',
        'unavailableBody',
        'refresh',
        'support',
      ]) {
        expect(copy.prepare.recovery?.[key]).toBeString();
      }
    }
  });
  it('permits creation only for paid, unclaimed or definitively rejected shipments', () => {
    for (const state of ['unclaimed', 'retryable_rejected']) {
      expect(
        resolveShipmentLabelState({
          ...shipment,
          label_generation_state: state,
        }),
      ).toBe('ready');
    }
    for (const status of [
      'preparing',
      'shipped',
      'delivered',
      'completed',
      'cancelled',
      'refunded',
    ] as const) {
      expect(resolveShipmentLabelState({ ...shipment, status })).toBe(
        'unavailable',
      );
    }
  });

  it('does not offer creation while a claim or provider request is pending', () => {
    for (const state of ['claimed', 'generation_sent']) {
      expect(
        resolveShipmentLabelState({
          ...shipment,
          label_generation_state: state,
        }),
      ).toBe('processing');
    }
  });

  it('requires reconciliation for uncertain purchases or incomplete generated labels', () => {
    for (const state of ['orphan_pending', 'generated']) {
      expect(
        resolveShipmentLabelState({
          ...shipment,
          label_generation_state: state,
        }),
      ).toBe('reconciliation');
    }
    expect(
      resolveShipmentLabelState({ ...shipment, tracking_number: 'tracking-1' }),
    ).toBe('reconciliation');
  });

  it('keeps a saved label available after a read failure without enabling another purchase', () => {
    expect(
      resolveShipmentLabelState(
        { ...shipment, label_url: 'https://labels.example.test/label.pdf' },
        true,
      ),
    ).toBe('available');
    expect(resolveShipmentLabelState(shipment, true)).toBe('unavailable');
  });

  it('fails closed for absent or unrecognized generation state', () => {
    expect(resolveShipmentLabelState(null)).toBe('unavailable');
    expect(
      resolveShipmentLabelState({ ...shipment, label_generation_state: '' }),
    ).toBe('unavailable');
    expect(
      resolveShipmentLabelState({
        ...shipment,
        label_generation_state: 'future_state',
      }),
    ).toBe('unavailable');
  });
});
