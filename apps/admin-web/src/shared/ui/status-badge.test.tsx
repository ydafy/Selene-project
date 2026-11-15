import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ProductStatus } from '@selene/types';

import { StatusBadge } from './status-badge';

const render = (status: ProductStatus) =>
  renderToStaticMarkup(<StatusBadge status={status} />);

describe('StatusBadge with product statuses', () => {
  it('colors each lowercase product status', () => {
    expect(render('verified')).toContain('text-status-delivered');
    expect(render('sold')).toContain('text-status-completed');
    expect(render('rejected')).toContain('text-status-dispute');
    expect(render('in_review')).toContain('text-status-pending');
    expect(render('hidden')).toContain('text-status-cancelled');
    expect(render('in_dispute')).toContain('text-status-dispute');
    expect(render('reserved')).toContain('text-status-preparing');
  });

  it('pulses only the in-progress product statuses', () => {
    expect(render('pending_verification')).toContain('animate-pulse');
    expect(render('in_review')).toContain('animate-pulse');
    expect(render('in_dispute')).toContain('animate-pulse');
    expect(render('verified')).not.toContain('animate-pulse');
    expect(render('hidden')).not.toContain('animate-pulse');
  });

  it('shows the status with spaces instead of underscores', () => {
    expect(render('in_review')).toContain('>in review<');
  });
});
