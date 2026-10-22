// Forwards Stripe sandbox webhooks to the local stripe-webhooks function of the
// Supabase stack running for this worktree. Each worktree gets its own ports,
// so the target URL is read from `supabase status` instead of being fixed.

/** Events handled by supabase/functions/stripe-webhooks. Keep docs/go-live.md in sync. */
export const STRIPE_WEBHOOK_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'setup_intent.succeeded',
  'refund.updated',
  'refund.failed',
  'account.updated',
  'account.external_account.created',
  'account.external_account.updated',
  'account.external_account.deleted',
  'payout.created',
  'payout.updated',
  'payout.paid',
  'payout.failed',
  'payout.canceled',
] as const;

function readApiUrl(statusEnv: string): string | undefined {
  const trimmed = statusEnv.trim();
  // Stack mode prints one JSON object; the default mode prints KEY=value lines.
  if (trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    const value =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).API_URL
        : undefined;
    return typeof value === 'string' ? value : undefined;
  }
  const line = trimmed
    .split(/\r?\n/)
    .find((entry) => entry.startsWith('API_URL='));
  return line?.slice('API_URL='.length).trim().replace(/^"|"$/g, '');
}

export function parseLocalApiUrl(statusEnv: string): string {
  const url = readApiUrl(statusEnv);
  if (!url) throw new Error('LOCAL_STACK_NOT_RUNNING');

  const { hostname } = new URL(url);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error('LOCAL_API_URL_REQUIRED');
  }
  return url;
}

export function buildStripeListenArgs(apiUrl: string): string[] {
  const target = `${apiUrl.replace(/\/+$/, '')}/functions/v1/stripe-webhooks`;
  return [
    'listen',
    '--events',
    STRIPE_WEBHOOK_EVENTS.join(','),
    '--forward-to',
    target,
    '--forward-connect-to',
    target,
  ];
}

if (import.meta.main) {
  const status = Bun.spawnSync(['supabase', 'status', '--env'], {
    stderr: 'inherit',
  });
  let apiUrl: string;
  try {
    apiUrl = parseLocalApiUrl(status.stdout.toString());
  } catch (error) {
    console.error(
      error instanceof Error && error.message === 'LOCAL_API_URL_REQUIRED'
        ? 'Refusing to forward Stripe events: the API URL is not local.'
        : 'Local Supabase stack is not running. Run `supabase start` first.',
    );
    process.exit(1);
  }

  console.log(`Forwarding Stripe sandbox webhooks to ${apiUrl}`);
  const listen = Bun.spawn(['stripe', ...buildStripeListenArgs(apiUrl)], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(await listen.exited);
}
