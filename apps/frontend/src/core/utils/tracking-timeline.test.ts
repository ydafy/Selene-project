import { describe, expect, it } from 'bun:test';

import {
  getTrackingEventLabelKey,
  getTrackingEventDescription,
} from './tracking-timeline';

describe('shipment tracking timeline presentation', () => {
  it('uses the carrier description when one is available', () => {
    expect(
      getTrackingEventDescription({
        raw_status: 'Out for Delivery',
        status_description: 'The courier is delivering your package.',
      }),
    ).toBe('The courier is delivering your package.');
  });

  it('falls back to the raw carrier status and maps each canonical event to its translation key', () => {
    expect(
      getTrackingEventDescription({
        raw_status: 'Delayed',
        status_description: null,
      }),
    ).toBe('Delayed');
    expect(getTrackingEventLabelKey('exception')).toBe(
      'orders:tracking.events.exception',
    );
  });
});
