import { asRecord } from './as-record';

/** The stable server error code carried by a thrown error, if any. */
export function getErrorCode(error: unknown): string | null {
  const code = asRecord(error)?.code;
  return typeof code === 'string' ? code : null;
}
