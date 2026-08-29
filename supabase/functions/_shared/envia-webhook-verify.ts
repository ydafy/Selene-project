const replayWindowMs = 5 * 60 * 1_000;

export interface VerifyEnviaWebhookInput { headers: Headers; rawBody: string; secret: string; now?: number; }

export function constantTimeEqual(left: string, right: string): boolean {
  const longestLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < longestLength; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

const parseWebhookTimestamp = (value: string): number | null => {
  if (!/^(?:\d{10}|\d{13})$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return value.length === 10 ? parsed * 1_000 : parsed;
};

const sign = async (payload: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export async function verifyEnviaWebhook({ headers, rawBody, secret, now = Date.now() }: VerifyEnviaWebhookInput): Promise<boolean> {
  const event = headers.get('X-Webhook-Event');
  const timestamp = headers.get('X-Webhook-Timestamp');
  const signature = headers.get('X-Webhook-Signature');
  const signatureMatch = signature?.match(/^v1=([a-f0-9]{64})$/i);
  if (!event || !timestamp || !signatureMatch || !secret) return false;
  const eventAt = parseWebhookTimestamp(timestamp);
  if (eventAt === null || Math.abs(now - eventAt) > replayWindowMs) return false;
  const expectedSignature = await sign(`${timestamp}.${event}.${rawBody}`, secret);
  return constantTimeEqual(expectedSignature, signatureMatch[1].toLowerCase());
}
