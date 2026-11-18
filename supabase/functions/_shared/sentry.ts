// Sentry error reporting for Edge Functions. See odd/tasks/sentry-observability.md (L9).
// Reports thrown errors and 5xx responses only. Never reads or attaches request or
// response bodies, headers, URLs, query strings, user ids or emails. Any failure to
// load or call the SDK degrades to a plain passthrough: Sentry must never break a
// money flow. Also offers `reportMessage` and `withMonitor` for the cron watchdog (L12),
// and `reportMessagesDelivered`, which says which events Sentry acknowledged
// (odd/tasks/table-cleanup.md S6b).

const FLUSH_TIMEOUT_MS = 2000;
/**
 * Events captured before waiting for their acknowledgements. Well below the
 * transport buffer of @sentry/core 11.8.0 (64 requests; a full buffer drops the
 * event and still resolves), so a batch never overflows it.
 */
const DELIVERY_CHUNK_SIZE = 10;

interface SentryScope {
  setTag(key: string, value: string): unknown;
  setFingerprint(fingerprint: string[]): unknown;
  setExtra(key: string, value: unknown): unknown;
}

interface SentryEvent {
  user?: unknown;
  request?: unknown;
  [key: string]: unknown;
}

interface SentryInitOptions {
  dsn: string;
  defaultIntegrations: false;
  sendDefaultPii: false;
  tracesSampleRate: 0;
  // Without this, 5xx messages carry the helper's own stack and Sentry titles
  // every one of them after a helper frame instead of the message text.
  attachStacktrace: false;
  environment: string;
  beforeSend: (event: SentryEvent) => SentryEvent | null;
}

/** The subset of `npm:@sentry/deno` this helper uses. */
export interface SentrySdk {
  init(options: SentryInitOptions): unknown;
  withScope<T>(callback: (scope: SentryScope) => T): T;
  captureException(error: unknown): unknown;
  /** Returns the event id. */
  captureMessage(message: string, level: 'error'): string;
  getClient(): SentryClient | undefined;
  withMonitor<T>(
    slug: string,
    callback: () => T,
    config: SentryMonitorConfig,
  ): T;
  /** Resolves true once every queued request settled, whatever Sentry answered; false on timeout. */
  flush(timeout?: number): Promise<unknown>;
}

/** Sentry's answer to one sent envelope; empty when nothing was sent. */
export interface SentrySendResponse {
  statusCode?: number;
}

/** The subset of the SDK client this helper uses. */
export interface SentryClient {
  /** Fires after the transport answered (or dropped) one event; returns the unregister function. */
  on(
    hook: 'afterSendEvent',
    callback: (
      event: { event_id?: string },
      sendResponse: SentrySendResponse,
    ) => void,
  ): () => void;
}

/** Sentry Cron Monitor config, as accepted by the SDK `withMonitor`. */
export interface SentryMonitorConfig {
  schedule: { type: 'crontab'; value: string };
  checkinMargin: number;
  maxRuntime: number;
  timezone: string;
}

export interface SentryMessageOptions {
  fingerprint: string[];
  tags: Record<string, string>;
}

/** One error message with its own tags, fingerprint and extra data. */
export interface SentryDeliveredMessage extends SentryMessageOptions {
  message: string;
  extra: Record<string, unknown>;
}

export interface SentryWrapperDeps {
  getEnv: (name: string) => string | undefined;
  loadSdk: () => Promise<SentrySdk>;
  log: (message: string) => void;
  /** How long `reportMessagesDelivered` waits for each chunk's acknowledgements. */
  deliveryTimeoutMs?: number;
}

type Handler = (req: Request) => Response | Promise<Response>;

const stripPersonalData = (event: SentryEvent): SentryEvent => {
  delete event.user;
  delete event.request;
  return event;
};

export function createSentry(deps: SentryWrapperDeps) {
  const deliveryTimeoutMs = deps.deliveryTimeoutMs ?? FLUSH_TIMEOUT_MS;
  let sdkPromise: Promise<SentrySdk | null> | null = null;

  const getSdk = (dsn: string): Promise<SentrySdk | null> => {
    sdkPromise ??= (async () => {
      try {
        const sdk = await deps.loadSdk();
        sdk.init({
          dsn,
          defaultIntegrations: false,
          sendDefaultPii: false,
          tracesSampleRate: 0,
          attachStacktrace: false,
          environment: deps.getEnv('SENTRY_ENVIRONMENT') ?? 'production',
          beforeSend: stripPersonalData,
        });
        return sdk;
      } catch (error) {
        // The error text is not logged: it can echo the DSN.
        deps.log(
          `Sentry disabled: SDK failed to load or initialize (${error instanceof Error ? error.name : 'unknown error'})`,
        );
        return null;
      }
    })();
    return sdkPromise;
  };

  const report = async (
    sdk: SentrySdk,
    capture: () => unknown,
  ): Promise<void> => {
    try {
      capture();
      await sdk.flush(FLUSH_TIMEOUT_MS);
    } catch {
      // Reporting must never change the function's outcome.
    }
  };

  /** The SDK when `SENTRY_DSN` is set and the SDK loads; otherwise null. */
  const getActiveSdk = async (): Promise<SentrySdk | null> => {
    const dsn = deps.getEnv('SENTRY_DSN');
    return dsn ? getSdk(dsn) : null;
  };

  /** Reports one error message in its own scope. No-op without a DSN; never throws. */
  const reportMessage = async (
    message: string,
    options: SentryMessageOptions,
  ): Promise<void> => {
    const sdk = await getActiveSdk();
    if (!sdk) return;
    await report(sdk, () =>
      sdk.withScope((scope) => {
        for (const [key, value] of Object.entries(options.tags))
          scope.setTag(key, value);
        scope.setFingerprint(options.fingerprint);
        return sdk.captureMessage(message, 'error');
      }),
    );
  };

  /**
   * Captures one chunk and resolves, per message, whether Sentry answered its
   * event with a 2xx before the timeout. The hook ignores events this call did
   * not capture and is removed before resolving. A capture that throws makes
   * the whole chunk undelivered.
   */
  const deliverChunk = (
    sdk: SentrySdk,
    client: SentryClient,
    chunk: SentryDeliveredMessage[],
  ): Promise<boolean[]> =>
    new Promise((resolve) => {
      const outcomes = new Map<string, boolean | undefined>();
      const ids: Array<string | undefined> = [];
      let done = false;
      let unregister: () => void = () => undefined;
      const finish = (failAll: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          unregister();
        } catch {
          // Unregistering is best effort.
        }
        resolve(
          ids.map(
            (id) => !failAll && id !== undefined && outcomes.get(id) === true,
          ),
        );
      };
      const allAnswered = () =>
        ids.length === chunk.length &&
        [...outcomes.values()].every((outcome) => outcome !== undefined);
      const timer = setTimeout(() => finish(false), deliveryTimeoutMs);

      try {
        unregister = client.on('afterSendEvent', (event, sendResponse) => {
          const id = event.event_id;
          if (!id || !outcomes.has(id) || outcomes.get(id) !== undefined)
            return;
          const status = sendResponse.statusCode;
          outcomes.set(
            id,
            typeof status === 'number' && status >= 200 && status < 300,
          );
          if (allAnswered()) finish(false);
        });
        for (const { message, fingerprint, tags, extra } of chunk) {
          const id = sdk.withScope((scope) => {
            for (const [key, value] of Object.entries(tags))
              scope.setTag(key, value);
            for (const [key, value] of Object.entries(extra))
              scope.setExtra(key, value);
            scope.setFingerprint(fingerprint);
            return sdk.captureMessage(message, 'error');
          });
          const known = typeof id === 'string' && id !== '' ? id : undefined;
          ids.push(known);
          if (known) outcomes.set(known, undefined);
        }
      } catch {
        ids.length = chunk.length;
        finish(true);
        return;
      }
      if (allAnswered()) finish(false);
    });

  /**
   * Captures each message as an error in its own scope, in chunks of
   * DELIVERY_CHUNK_SIZE, and resolves one flag per message: true only when
   * Sentry answered that event with a 2xx before the timeout (the SDK
   * `afterSendEvent` hook). A full transport buffer, a rate limit (429), a
   * server error, a network error or no answer all count as not delivered.
   * Stops after the first chunk with an undelivered event; the later messages
   * resolve false without being sent. Without a DSN, or when the SDK cannot
   * load, every flag is false. Never throws.
   */
  const reportMessagesDelivered = async (
    messages: SentryDeliveredMessage[],
  ): Promise<boolean[]> => {
    const results = messages.map(() => false);
    if (messages.length === 0) return results;
    const sdk = await getActiveSdk();
    if (!sdk) return results;
    let client: SentryClient | undefined;
    try {
      client = sdk.getClient();
    } catch {
      return results;
    }
    if (!client) return results;

    for (let start = 0; start < messages.length; start += DELIVERY_CHUNK_SIZE) {
      const delivered = await deliverChunk(
        sdk,
        client,
        messages.slice(start, start + DELIVERY_CHUNK_SIZE),
      );
      delivered.forEach((ok, i) => {
        results[start + i] = ok;
      });
      if (!delivered.every(Boolean)) break;
    }
    return results;
  };

  /**
   * Runs `fn` inside a Sentry Cron Monitor (check-in on start and on finish).
   * Without a DSN, or when Sentry fails before `fn` starts, `fn` runs plainly.
   * An error from `fn` always propagates unchanged.
   */
  const withMonitor = async <T>(
    slug: string,
    config: SentryMonitorConfig,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const sdk = await getActiveSdk();
    if (!sdk) return fn();

    let started = false;
    // Typed through `as` so TypeScript does not narrow it to `null`: it is only
    // assigned inside the monitor callback, which control-flow analysis cannot see.
    let outcome = null as
      { ok: true; value: T } | { ok: false; error: unknown } | null;
    try {
      const value = await sdk.withMonitor(
        slug,
        async () => {
          started = true;
          try {
            const result = await fn();
            outcome = { ok: true, value: result };
            return result;
          } catch (error) {
            outcome = { ok: false, error };
            throw error;
          }
        },
        config,
      );
      await report(sdk, () => undefined);
      return value;
    } catch (error) {
      if (!started) return fn();
      await report(sdk, () => undefined);
      const finished = outcome;
      if (finished?.ok) return finished.value;
      throw finished ? finished.error : error;
    }
  };

  const withSentry = function withSentry(
    functionName: string,
    handler: Handler,
  ): Handler {
    return async (req: Request): Promise<Response> => {
      const dsn = deps.getEnv('SENTRY_DSN');
      if (!dsn) return handler(req);

      const sdk = await getSdk(dsn);
      if (!sdk) return handler(req);

      return sdk.withScope(async (scope) => {
        try {
          scope.setTag('edge_function', functionName);
          scope.setTag('http.method', req.method);
          const region = deps.getEnv('SB_REGION');
          if (region) scope.setTag('sb.region', region);
          const executionId = deps.getEnv('SB_EXECUTION_ID');
          if (executionId) scope.setTag('sb.execution_id', executionId);
        } catch {
          // Tagging is best effort.
        }

        let response: Response;
        try {
          response = await handler(req);
        } catch (error) {
          await report(sdk, () => sdk.captureException(error));
          throw error;
        }

        if (response.status >= 500) {
          // The message's own stack points into this helper; group by function and status instead.
          await report(sdk, () => {
            scope.setFingerprint([
              'edge-function-5xx',
              functionName,
              String(response.status),
            ]);
            return sdk.captureMessage(
              `${functionName} responded ${response.status}`,
              'error',
            );
          });
        }
        return response;
      });
    };
  };

  return { withSentry, reportMessage, reportMessagesDelivered, withMonitor };
}

export const createSentryWrapper = (deps: SentryWrapperDeps) =>
  createSentry(deps).withSentry;

export const {
  withSentry,
  reportMessage,
  reportMessagesDelivered,
  withMonitor,
} = createSentry({
  getEnv: (name) => Deno.env.get(name),
  loadSdk: async () =>
    (await import('npm:@sentry/deno@11.8.0')) as unknown as SentrySdk,
  log: (message) => console.error(message),
});
