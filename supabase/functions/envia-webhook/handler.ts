import {
  buildWebhookTrackingEvent,
  type TrackingEventInput,
  webhookReceipt,
} from '../_shared/envia-tracking-ingestion.ts';

export interface TrackingSubject {
  shipmentId: string;
  disputeId: string | null;
}

export interface EnviaWebhookHandlerDependencies {
  verify: (input: { headers: Headers; rawBody: string }) => Promise<boolean>;
  claim: (input: {
    deliveryId: string;
    eventName: string;
    rawBody: string;
  }) => Promise<
    { kind: 'new'; id: string } | { kind: 'duplicate' } | { kind: 'collision' }
  >;
  resolveSubject: (trackingNumber: string) => Promise<TrackingSubject | null>;
  record: (
    input: TrackingSubject & { deliveryId: string; event: TrackingEventInput },
  ) => Promise<void>;
  mark: (input: {
    deliveryId: string;
    state: 'processed' | 'failed';
    errorCode?: string;
  }) => Promise<void>;
  schedule: (work: () => Promise<void>) => Promise<void>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function createEnviaWebhookHandler(
  dependencies: EnviaWebhookHandlerDependencies,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'GET') return json({ status: 'ok' });
    if (req.method !== 'POST')
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

    const rawBody = await req.text();
    if (!(await dependencies.verify({ headers: req.headers, rawBody }))) {
      return json({ error: 'INVALID_SIGNATURE' }, 401);
    }

    const eventName = req.headers.get('X-Webhook-Event');
    const deliveryId = req.headers.get('X-Webhook-Id');
    if (eventName !== 'tracking.simple' || !deliveryId) {
      return json({ error: 'INVALID_WEBHOOK_EVENT' }, 400);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: 'INVALID_JSON' }, 400);
    }
    const event = buildWebhookTrackingEvent(payload);
    if (!event) return json({ error: 'INVALID_TRACKING_PAYLOAD' }, 400);

    const claim = await dependencies.claim({ deliveryId, eventName, rawBody });
    if (claim.kind === 'duplicate') return json(webhookReceipt(true));
    if (claim.kind === 'collision') {
      return json({ error: 'DELIVERY_PAYLOAD_CONFLICT' }, 409);
    }

    await dependencies.schedule(async () => {
      try {
        const subject = await dependencies.resolveSubject(event.trackingNumber);
        if (!subject) throw new Error('TRACKING_SUBJECT_NOT_UNIQUE');
        await dependencies.record({ ...subject, deliveryId: claim.id, event });
        await dependencies.mark({ deliveryId: claim.id, state: 'processed' });
      } catch (error) {
        await dependencies.mark({
          deliveryId: claim.id,
          state: 'failed',
          errorCode:
            error instanceof Error
              ? error.message.slice(0, 120)
              : 'TRACKING_RECORD_FAILED',
        });
      }
    });

    return json(webhookReceipt(false));
  };
}
