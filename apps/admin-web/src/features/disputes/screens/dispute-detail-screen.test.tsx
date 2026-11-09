import { expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildStoredShippingEvidence } from '../../../../../../supabase/functions/generate-shipping-label/shipping-evidence.ts';

// The page mocks its hooks, router, and Supabase client: keep those mocks out of
// the shared Bun module cache.
if (process.env.DISPUTE_DETAIL_PAGE_CHILD !== '1') {
  it('checks the dispute detail page in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { ...process.env, DISPUTE_DETAIL_PAGE_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  const orderId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  const sellerId = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
  const photo = (slot: number) =>
    `shipments/${orderId}/${sellerId}/slot_${slot}_1700000000000.jpg`;
  const packingPhotos = [photo(0), photo(1), photo(2)];

  const dispute = {
    id: 'dispute-1',
    status: 'open',
    description: 'Llegó dañado',
    admin_notes: null,
    resolution_type: null,
    updated_at: '2026-11-01T10:00:00.000Z',
    buyer: { id: 'buyer-1', username: 'buyer' },
    seller: { id: sellerId, username: 'seller' },
    buyer_evidence: null,
    shipment: {
      id: 'shipment-1',
      // Exactly what generate-shipping-label stores in shipments.shipping_evidence.
      shipping_evidence: buildStoredShippingEvidence(packingPhotos),
      origin_address: null,
      tracking_number: 'TRK-1',
    },
  };

  mock.module('react-router-dom', () => ({
    useParams: () => ({ id: dispute.id }),
    useNavigate: () => () => undefined,
  }));
  mock.module('@/shared/lib/supabase', () => ({ supabase: {} }));
  mock.module('../hooks/use-dispute-detail', () => ({
    useDisputeDetail: () => ({
      data: dispute,
      isLoading: false,
      isError: false,
      refetch: async () => undefined,
    }),
  }));
  mock.module('../hooks/use-dispute-actions', () => ({
    useDisputeActions: () => ({
      resolveDispute: async () => undefined,
      isLoading: false,
    }),
    useDisputeLock: () => ({
      acquireLock: () => undefined,
      releaseLock: () => undefined,
      lockStatus: { isLockedByOther: false, lockerName: null },
    }),
  }));
  mock.module('@/shared/ui/secure-image', () => ({
    SecureImage: ({
      path,
      alt,
      bucket,
    }: {
      path: string;
      alt: string;
      bucket?: string;
    }) => <img alt={alt} data-path={path} data-bucket={bucket} />,
  }));
  const { DisputeDetailPage } = await import('./dispute-detail-screen');

  it("passes the seller's stored packing photos to SecureImage from the evidence bucket", () => {
    const html = renderToStaticMarkup(<DisputeDetailPage />);
    const sellerImages = [
      ...html.matchAll(
        /<img alt="Vendedor (\d)" data-path="([^"]*)" data-bucket="([^"]*)"/g,
      ),
    ].map(([, slot, path, bucket]) => ({ slot, path, bucket }));

    expect(sellerImages).toEqual([
      { slot: '0', path: photo(0), bucket: 'evidence' },
      { slot: '1', path: photo(1), bucket: 'evidence' },
      { slot: '2', path: photo(2), bucket: 'evidence' },
    ]);
  });
}
