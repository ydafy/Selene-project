import {
  buildPollingTrackingEvents,
  successfulPollingTargetIds,
  type EnviaPollingObservation,
  type PollingTrackingEvent,
  type PollingTrackingTarget,
} from '../_shared/envia-tracking-ingestion.ts';

export type TrackingStatus = 'preparing' | 'shipped';

export interface TrackShipmentsDependencies {
  acquireLease: (lane: TrackingStatus) => Promise<{
    acquired: boolean;
    leaseId?: string;
  }>;
  releaseLease: (lane: TrackingStatus, leaseId: string) => Promise<void>;
  selectTargets: (
    status: TrackingStatus,
    signal: AbortSignal,
  ) => Promise<PollingTrackingTarget[]>;
  fetchObservations: (
    trackingNumbers: string[],
    signal: AbortSignal,
  ) => Promise<EnviaPollingObservation[]>;
  record: (
    event: PollingTrackingEvent,
    pollingRunId: string,
    signal: AbortSignal,
  ) => Promise<{ inserted: boolean }>;
  markTracked: (
    targetIds: string[],
    trackedAt: string,
    signal: AbortSignal,
  ) => Promise<void>;
}

interface TrackShipmentsHandlerOptions {
  secret: string | undefined;
  pollingEnabled: string | undefined;
  dependencies: TrackShipmentsDependencies;
  now: () => Date;
  createDeadline: () => { signal: AbortSignal; dispose: () => void };
}

const BATCH_SIZE = 50;

class TrackingDeadlineExceededError extends Error {
  constructor() {
    super('TRACKING_DEADLINE_EXCEEDED');
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const hasConstantTimeSecret = (
  provided: string,
  expected: string | undefined,
): boolean => {
  if (!expected) return false;

  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  let difference = providedBytes.length ^ expectedBytes.length;
  const length = Math.max(providedBytes.length, expectedBytes.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (providedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
};

const isTrackingStatus = (value: unknown): value is TrackingStatus =>
  value === 'preparing' || value === 'shipped';

const deadlineGuard = (signal: AbortSignal): void => {
  if (signal.aborted) throw new TrackingDeadlineExceededError();
};

export function createTrackShipmentsHandler({
  secret,
  pollingEnabled,
  dependencies,
  now,
  createDeadline,
}: TrackShipmentsHandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST')
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

    if (
      !hasConstantTimeSecret(
        req.headers.get('Authorization') ?? '',
        secret ? `Bearer ${secret}` : undefined,
      )
    ) {
      return json({ error: 'UNAUTHORIZED' }, 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'INVALID_LANE' }, 400);
    }

    const lane =
      body && typeof body === 'object'
        ? (body as { lane?: unknown }).lane
        : undefined;
    if (!isTrackingStatus(lane)) return json({ error: 'INVALID_LANE' }, 400);

    if (pollingEnabled !== 'true') {
      return json({
        processed: 0,
        recorded: 0,
        lane,
        skipped: true,
        reason: 'disabled',
      });
    }

    const deadline = createDeadline();
    let leaseId: string | undefined;
    try {
      deadlineGuard(deadline.signal);
      const lease = await dependencies.acquireLease(lane);
      if (!lease.acquired) {
        return json({
          processed: 0,
          recorded: 0,
          lane,
          skipped: true,
          reason: 'busy',
        });
      }
      if (!lease.leaseId) throw new Error('TRACKING_LEASE_ACQUIRE_FAILED');
      leaseId = lease.leaseId;
      const targets = (
        await dependencies.selectTargets(lane, deadline.signal)
      ).slice(0, BATCH_SIZE);
      deadlineGuard(deadline.signal);
      if (!targets.length) return json({ processed: 0, recorded: 0, lane });

      const trackingNumbers = [
        ...new Set(targets.map((target) => target.trackingNumber)),
      ];
      const observations = await dependencies.fetchObservations(
        trackingNumbers,
        deadline.signal,
      );
      deadlineGuard(deadline.signal);

      const polledAt = now().toISOString();
      const events = buildPollingTrackingEvents(
        targets,
        observations,
        polledAt,
      );
      const observedTrackingNumbers = new Set(
        observations.map((observation) => observation.trackingNumber),
      );
      const fullyPersistedTargetIds = new Set<string>();
      const pollingRunId = crypto.randomUUID();
      let recorded = 0;

      for (const target of targets) {
        deadlineGuard(deadline.signal);
        const targetEvents = events.filter(
          (event) => event.targetId === target.id,
        );
        if (!targetEvents.length) continue;

        let fullyPersisted = true;
        for (const event of targetEvents) {
          deadlineGuard(deadline.signal);
          try {
            const result = await dependencies.record(
              event,
              pollingRunId,
              deadline.signal,
            );
            if (result.inserted) recorded += 1;
          } catch {
            fullyPersisted = false;
            break;
          }
        }

        if (fullyPersisted) fullyPersistedTargetIds.add(target.id);
      }

      deadlineGuard(deadline.signal);
      const trackedIds = [
        ...new Set([
          ...successfulPollingTargetIds(
            targets,
            events,
            fullyPersistedTargetIds,
          ),
          ...targets
            .filter(
              (target) => !observedTrackingNumbers.has(target.trackingNumber),
            )
            .map((target) => target.id),
        ]),
      ];
      if (trackedIds.length) {
        await dependencies.markTracked(trackedIds, polledAt, deadline.signal);
      }

      return json({ processed: targets.length, recorded, lane });
    } catch (error) {
      if (
        deadline.signal.aborted ||
        error instanceof TrackingDeadlineExceededError ||
        (error instanceof Error && error.message === 'TRACKING_DEADLINE_EXCEEDED')
      ) {
        return json({ error: 'TRACKING_DEADLINE_EXCEEDED' }, 504);
      }
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'TRACKING_RECONCILIATION_FAILED',
        },
        500,
      );
    } finally {
      if (leaseId) {
        try {
          await dependencies.releaseLease(lane, leaseId);
        } catch {
          // A lease expiry still recovers a crashed invocation; do not mask the primary result.
        }
      }
      deadline.dispose();
    }
  };
}
