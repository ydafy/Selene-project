import { expect, it, mock } from 'bun:test';
import * as React from 'react';

// The page pulls the Supabase client in through its buckets: keep the service mock
// out of the shared Bun module cache.
if (process.env.B44D_PAGE_CHILD !== '1') {
  it('checks the shipments page in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B44D_PAGE_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  mock.module('../services/carrierReviews', () => ({
    fetchCarrierReviews: async () => [],
    resolveCarrierReview: async () => undefined,
  }));
  const { CarrierReviewsPanel } = await import('../components/features/shipments/CarrierReviewsPanel');
  const { ShipmentsPage } = await import('./ShipmentsPage');

  type Element = React.ReactElement<Record<string, unknown>>;
  const nodes = (value: React.ReactNode): Element[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!React.isValidElement<Record<string, unknown>>(value)) return [];
    return [value, ...nodes(value.props.children as React.ReactNode)];
  };
  const label = (value: React.ReactNode): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(label).join('');
    return React.isValidElement<Record<string, unknown>>(value)
      ? label(value.props.children as React.ReactNode)
      : '';
  };

  it('titles the section Envíos', () => {
    const heading = nodes(ShipmentsPage()).find((n) => n.type === 'h1');
    expect(heading).toBeDefined();
    expect(label(heading!.props.children as React.ReactNode)).toBe('Envíos');
  });

  it('renders the carrier cancellations bucket', () => {
    expect(nodes(ShipmentsPage()).some((n) => n.type === CarrierReviewsPanel)).toBe(true);
  });
}
