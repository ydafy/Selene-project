import { describe, expect, it } from 'bun:test';
import { createCancellationReporter } from '../cancellation-alerts.ts';

function subject(report?: (message: string, options: { fingerprint: string[]; tags: Record<string, string> }) => unknown) {
  const logs: unknown[][] = [];
  const reports: { message: string; options: { fingerprint: string[]; tags: Record<string, string> } }[] = [];
  const reporter = createCancellationReporter(
    'cancel-order',
    (...args: unknown[]) => logs.push(args),
    report ??
      (async (message, options) => {
        reports.push({ message, options });
      }),
  );
  return { logs, reports, reporter };
}

describe('createCancellationReporter', () => {
  it('logs CRITICAL and sends one Sentry message with the exact fingerprint and tags', async () => {
    const { logs, reports, reporter } = subject();
    await reporter('CANCELLATION_REFUND_NOT_FOUND', {
      shipmentId: 'ship-1',
      refundId: 're_1',
      externalStartedAt: '2026-10-20T00:00:00.000Z',
    });
    expect(logs).toEqual([
      [
        'CRITICAL',
        'CANCELLATION_REFUND_NOT_FOUND',
        { shipmentId: 'ship-1', refundId: 're_1', externalStartedAt: '2026-10-20T00:00:00.000Z' },
      ],
    ]);
    expect(reports).toEqual([
      {
        message: 'cancel-order CANCELLATION_REFUND_NOT_FOUND',
        options: {
          fingerprint: ['shipment-cancellation', 'cancel-order', 'CANCELLATION_REFUND_NOT_FOUND'],
          tags: { edge_function: 'cancel-order', shipment_id: 'ship-1', refund_id: 're_1' },
        },
      },
    ]);
  });

  it('tags only string shipment and refund ids and never forwards other data', async () => {
    const { reports, reporter } = subject();
    await reporter('X', { shipmentId: 12, refundId: null, refundIds: ['re_1', 're_2'], dbError: 'secret' });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.options.tags).toEqual({ edge_function: 'cancel-order' });
    expect(JSON.stringify(reports[0])).not.toContain('secret');
    await reporter('Y', {});
    expect(reports[1]!.options.tags).toEqual({ edge_function: 'cancel-order' });
  });

  it('uses its own function name in the message, fingerprint and tag', async () => {
    const reports: { message: string; options: { fingerprint: string[]; tags: Record<string, string> } }[] = [];
    const reporter = createCancellationReporter('auto-cancel-preparing', () => undefined, async (message, options) => {
      reports.push({ message, options });
    });
    await reporter('M', { shipmentId: 's' });
    expect(reports[0]!.message).toBe('auto-cancel-preparing M');
    expect(reports[0]!.options.fingerprint).toEqual(['shipment-cancellation', 'auto-cancel-preparing', 'M']);
    expect(reports[0]!.options.tags.edge_function).toBe('auto-cancel-preparing');
  });

  it('swallows a rejecting or throwing Sentry call and still logs', async () => {
    for (const report of [
      async () => {
        throw new Error('sentry down');
      },
      () => {
        throw new Error('sentry down');
      },
    ]) {
      const { logs, reporter } = subject(report);
      await expect(reporter('M', { shipmentId: 's' })).resolves.toBeUndefined();
      expect(logs).toHaveLength(1);
    }
  });
});
