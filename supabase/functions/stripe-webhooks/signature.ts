export type ConstructStripeEvent<T> = (
  rawBody: string,
  signature: string,
  secret: string,
) => Promise<T>;

export type StripeSignatureResult<T> =
  | { ok: true; event: T }
  | { ok: false; reason: 'invalid_signature' | 'missing_secret' };

/**
 * Verifies a Stripe webhook against each configured signing secret in order
 * (platform first, then Connect). Empty secrets are skipped so a missing
 * configuration can never verify a request.
 */
export async function verifyStripeWebhookSignature<T>(input: {
  rawBody: string;
  signature: string;
  secrets: readonly string[];
  construct: ConstructStripeEvent<T>;
}): Promise<StripeSignatureResult<T>> {
  const secrets = input.secrets.filter((secret) => secret.length > 0);
  if (secrets.length === 0) return { ok: false, reason: 'missing_secret' };

  for (const secret of secrets) {
    try {
      const event = await input.construct(
        input.rawBody,
        input.signature,
        secret,
      );
      return { ok: true, event };
    } catch {
      // Try the next secret; the request is rejected if none matches.
    }
  }

  return { ok: false, reason: 'invalid_signature' };
}
