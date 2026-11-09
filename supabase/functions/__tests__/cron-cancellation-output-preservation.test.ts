import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

for (const [name, reason, message] of [
  [
    'auto-cancel-orders',
    'Cancelación automática: Excedió el límite de ${hours} horas para envío.',
    'Shipment cancelado exitosamente',
  ],
  [
    'auto-cancel-preparing',
    'Cancelación automática: Envío en preparación por más de ${hours} horas sin escaneo del carrier.',
    'Shipment en preparing cancelado exitosamente',
  ],
]) {
  describe(`${name} consumed outputs`, () => {
    const source = readFileSync(
      new URL(`../${name}/index.ts`, import.meta.url),
      'utf8',
    );
    test('new claims retain the exact cancellation reason; takeover still uses the winner', () => {
      expect(source).toContain('reason: `' + reason + '`');
      expect(source).toContain('p_reason: context.reason');
      expect(source).toContain('p_reason: winner.reason');
    });
    test('success log retains its exact message, IDs and frozen refund amount', () => {
      const success = source.slice(
        source.indexOf("if (result.status === 'cancelled')"),
        source.indexOf('// Delay'),
      );
      expect(success).toContain(`log('INFO', '${message}', {`);
      expect(success).toContain('shipmentId: shipment.id');
      expect(success).toContain('orderId: shipment.order_id');
      expect(success).toContain('refundAmountCents: result.value');
      expect(source).toContain('return frozen.refundRequest.amount;');
    });
  });
}
