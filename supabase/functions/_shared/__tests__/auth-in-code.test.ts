// source-text: supabase/config.toml is the deployed verify_jwt contract, and how a function authenticates its caller is only visible in its source
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The gateway verify_jwt check only understands the legacy JWT keys, so every function runs with
// verify_jwt = false and authenticates its caller in code (#399, before the asymmetric JWT signing
// keys of #337). A new function must be added to EXPECTED with the mechanism it uses.
const FUNCTIONS_DIR = join(import.meta.dir, '..', '..');
const CONFIG = readFileSync(
  join(FUNCTIONS_DIR, '..', 'config.toml'),
  'utf8',
).replace(/\r\n/g, '\n');

type Mechanism =
  | 'user-token'
  | 'cron-secret'
  | 'track-shipments-bearer'
  | 'stripe-signature'
  | 'envia-signature'
  | 'public';

// Each mechanism's evidence in the function's non-test source.
const MARKERS: Record<Exclude<Mechanism, 'public'>, RegExp[]> = {
  // A user or admin session: the bearer token is resolved with Supabase Auth.
  'user-token': [/\.auth\.(getUser|getClaims)\(/],
  // The shared constant-time x-cron-secret check (_shared/auth/cron-auth.ts).
  'cron-secret': [/isAuthorizedCronRequest\(/],
  // track-shipments: `Authorization: Bearer <TRACK_SHIPMENTS_CRON_SECRET>`, compared in constant time.
  'track-shipments-bearer': [
    /hasConstantTimeSecret\(/,
    /TRACK_SHIPMENTS_CRON_SECRET/,
  ],
  'stripe-signature': [/\.webhooks\.constructEvent(Async)?\(/],
  'envia-signature': [/verifyEnviaWebhook\(/],
};

// Functions that check no caller at all, each with the reason it is safe.
const PUBLIC_REASONS: Record<string, string> = {
  'connect-onboarding-return':
    'Stripe Connect return/refresh URL: only redirects to configured deep links; no database, Stripe, or user data',
};

const EXPECTED: Record<string, Mechanism> = {
  'account-closure-cleanup': 'cron-secret',
  'acknowledge-shipment-late-carrier-activity': 'user-token',
  'auto-cancel-orders': 'cron-secret',
  'auto-cancel-preparing': 'cron-secret',
  'cancel-order': 'user-token',
  'checkout-recovery-worker': 'cron-secret',
  'complete-delivered-shipments': 'cron-secret',
  'confirm-shipment-delivery': 'user-token',
  'connect-onboarding-return': 'public',
  'create-connect-account': 'user-token',
  'create-connect-payment': 'user-token',
  'create-dispute': 'user-token',
  'create-return-intent': 'user-token',
  'cron-watchdog': 'cron-secret',
  'delete-account': 'user-token',
  'dispatch-push': 'cron-secret',
  'envia-webhook': 'envia-signature',
  'generate-return-label': 'user-token',
  'generate-shipping-label': 'user-token',
  'get-connect-payout-release-queue': 'user-token',
  'get-seller-onboarding': 'user-token',
  'get-shipping-quote': 'user-token',
  'list-shipment-label-reconciliations': 'user-token',
  'list-shipment-late-carrier-activity': 'user-token',
  'list-shipment-operation-reviews': 'user-token',
  'list-shipment-refund-problems': 'user-token',
  'manage-payment-methods': 'user-token',
  'reconcile-connect-payments': 'user-token',
  'reconcile-stripe-fees': 'cron-secret',
  'refresh-connect-account-status': 'user-token',
  'release-connect-payout': 'user-token',
  'resolve-dispute': 'user-token',
  'resolve-dispute-refund': 'user-token',
  'resolve-shipment-label-reconciliation': 'user-token',
  'resolve-shipment-operation-review': 'user-token',
  'resolve-shipment-refund': 'user-token',
  'resolve-shipment-tracking-url': 'user-token',
  'resume-pending-payouts': 'cron-secret',
  'rollback-connect-payment': 'user-token',
  'stripe-webhooks': 'stripe-signature',
  'track-shipments': 'track-shipments-bearer',
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });

// Comments are stripped so a marker that appears only in a comment does not count.
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const sourceOf = (name: string): string =>
  sourceFiles(join(FUNCTIONS_DIR, name))
    .map((file) => stripComments(readFileSync(file, 'utf8')))
    .join('\n');

const FUNCTIONS = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .sort();

const verifyJwtOf = (name: string): string | undefined =>
  new RegExp(
    `^\\[functions\\.${name}\\]\\n(?:#.*\\n)*verify_jwt = (true|false)$`,
    'm',
  ).exec(CONFIG)?.[1];

describe('every Edge Function authenticates in code with verify_jwt = false', () => {
  it('classifies every function directory', () => {
    expect(FUNCTIONS).toEqual(Object.keys(EXPECTED).sort());
  });

  it('declares no verify_jwt = true in supabase/config.toml', () => {
    expect(CONFIG).not.toMatch(/^verify_jwt = true$/m);
  });

  for (const name of FUNCTIONS) {
    it(`${name} declares verify_jwt = false in supabase/config.toml`, () => {
      expect(verifyJwtOf(name)).toBe('false');
    });

    const mechanism = EXPECTED[name];
    if (mechanism === 'public') {
      it(`${name} is public and touches no database, Stripe, or user data`, () => {
        expect(PUBLIC_REASONS[name]).toBeTruthy();
        const source = sourceOf(name);
        expect(source).not.toMatch(
          /createClient|SUPABASE_SERVICE_ROLE_KEY|readSupabaseSecretKey|STRIPE_SECRET_KEY|Authorization/,
        );
      });
    } else if (mechanism) {
      it(`${name} authenticates by ${mechanism}`, () => {
        const source = sourceOf(name);
        for (const marker of MARKERS[mechanism]) {
          expect(source).toMatch(marker);
        }
      });
    }
  }

  it('lists a reason only for public functions', () => {
    expect(Object.keys(PUBLIC_REASONS).sort()).toEqual(
      Object.entries(EXPECTED)
        .filter(([, mechanism]) => mechanism === 'public')
        .map(([name]) => name)
        .sort(),
    );
  });
});
