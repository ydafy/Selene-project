import { ShipmentTrackingUrlRequestSchema } from './request-schema.ts';

export interface TrackingUrlSubject {
  buyerId: string;
  sellerId: string;
  trackingNumber: string | null;
}

export interface ResolveShipmentTrackingUrlDependencies {
  authenticate: (request: Request) => Promise<{ id: string } | null>;
  loadSubject: (shipmentId: string) => Promise<TrackingUrlSubject | null>;
  loadRole: (userId: string) => Promise<string | null>;
  resolveUrl: (trackingNumber: string) => string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function createResolveShipmentTrackingUrlHandler(
  dependencies: ResolveShipmentTrackingUrlDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

    const body = await request.json().catch(() => null);
    const parsed = ShipmentTrackingUrlRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'INVALID_SHIPMENT_ID' }, 400);
    const { shipmentId } = parsed.data;

    const user = await dependencies.authenticate(request);
    if (!user) return json({ error: 'AUTH_REQUIRED' }, 401);

    const subject = await dependencies.loadSubject(shipmentId);
    if (!subject) return json({ error: 'NOT_FOUND' }, 404);

    const role = await dependencies.loadRole(user.id);
    const isAuthorized =
      user.id === subject.buyerId ||
      user.id === subject.sellerId ||
      role === 'admin';
    if (!isAuthorized) return json({ error: 'FORBIDDEN' }, 403);

    return json({
      url: subject.trackingNumber
        ? dependencies.resolveUrl(subject.trackingNumber)
        : null,
    });
  };
}
