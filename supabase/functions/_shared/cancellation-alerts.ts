import { reportMessage, type SentryMessageOptions } from './sentry.ts';

/**
 * CRITICAL log plus a Sentry message for shipment cancellations that need a
 * human. Only the function name, shipment id and refund id are attached: no
 * bodies or user data. Reporting never throws, so it cannot change the outcome.
 */
export function createCancellationReporter(
  functionName: string,
  log: (level: 'CRITICAL', msg: string, data?: Record<string, unknown>) => unknown,
  report: (message: string, options: SentryMessageOptions) => unknown = reportMessage,
) {
  return async (message: string, data: Record<string, unknown>): Promise<void> => {
    log('CRITICAL', message, data);
    const tags: Record<string, string> = { edge_function: functionName };
    if (typeof data.shipmentId === 'string') tags.shipment_id = data.shipmentId;
    if (typeof data.refundId === 'string') tags.refund_id = data.refundId;
    try {
      await report(functionName + ' ' + message, {
        fingerprint: ['shipment-cancellation', functionName, message],
        tags,
      });
    } catch {
      // Reporting must never change the cancellation outcome.
    }
  };
}
