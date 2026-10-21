// Sentry error reporting for Edge Functions. See odd/tasks/sentry-observability.md (L9).
// Reports thrown errors and 5xx responses only. Never reads or attaches request or
// response bodies, headers, URLs, query strings, user ids or emails. Any failure to
// load or call the SDK degrades to a plain passthrough: Sentry must never break a
// money flow. Also offers `reportMessage` and `withMonitor` for the cron watchdog (L12).

const FLUSH_TIMEOUT_MS = 2000;

interface SentryScope {
  setTag(key: string, value: string): unknown;
  setFingerprint(fingerprint: string[]): unknown;
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
  captureMessage(message: string, level: 'error'): unknown;
  withMonitor<T>(slug: string, callback: () => T, config: SentryMonitorConfig): T;
  flush(timeout?: number): Promise<unknown>;
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

export interface SentryWrapperDeps {
  getEnv: (name: string) => string | undefined;
  loadSdk: () => Promise<SentrySdk>;
  log: (message: string) => void;
}

type Handler = (req: Request) => Response | Promise<Response>;

const stripPersonalData = (event: SentryEvent): SentryEvent => {
  delete event.user;
  delete event.request;
  return event;
};

export function createSentry(deps: SentryWrapperDeps) {
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

  const report = async (sdk: SentrySdk, capture: () => unknown): Promise<void> => {
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
  const reportMessage = async (message: string, options: SentryMessageOptions): Promise<void> => {
    const sdk = await getActiveSdk();
    if (!sdk) return;
    await report(sdk, () =>
      sdk.withScope((scope) => {
        for (const [key, value] of Object.entries(options.tags)) scope.setTag(key, value);
        scope.setFingerprint(options.fingerprint);
        return sdk.captureMessage(message, 'error');
      }),
    );
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
    let outcome: { ok: true; value: T } | { ok: false; error: unknown } | null = null;
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
      const finished = outcome as typeof outcome;
      if (finished?.ok) return finished.value;
      throw finished ? finished.error : error;
    }
  };

  const withSentry = function withSentry(functionName: string, handler: Handler): Handler {
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
            scope.setFingerprint(['edge-function-5xx', functionName, String(response.status)]);
            return sdk.captureMessage(`${functionName} responded ${response.status}`, 'error');
          });
        }
        return response;
      });
    };
  };

  return { withSentry, reportMessage, withMonitor };
}

export const createSentryWrapper = (deps: SentryWrapperDeps) => createSentry(deps).withSentry;

export const { withSentry, reportMessage, withMonitor } = createSentry({
  getEnv: (name) => Deno.env.get(name),
  loadSdk: async () => (await import('npm:@sentry/deno@11.8.0')) as unknown as SentrySdk,
  log: (message) => console.error(message),
});
