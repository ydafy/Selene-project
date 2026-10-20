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

const isShipmentId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function createResolveShipmentTrackingUrlHandler(
  dependencies: ResolveShipmentTrackingUrlDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

    const body = await request.json().catch(() => null);
    const shipmentId = body && typeof body === 'object' ? body.shipmentId : null;
    if (!isShipmentId(shipmentId)) return json({ error: 'INVALID_SHIPMENT_ID' }, 400);

    const user = await dependencies.authenticate(request);
    if (!user) return json({ error: 'UNAUTHORIZED' }, 401);

    const subject = await dependencies.loadSubject(shipmentId);
    if (!subject) return json({ error: 'NOT_FOUND' }, 404);

    const role = await dependencies.loadRole(user.id);
    const isAuthorized =
      user.id === subject.buyerId || user.id === subject.sellerId || role === 'admin';
    if (!isAuthorized) return json({ error: 'FORBIDDEN' }, 403);

    return json({
      url: subject.trackingNumber
        ? dependencies.resolveUrl(subject.trackingNumber)
        : null,
    });
  };
}
