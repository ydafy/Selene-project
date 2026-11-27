export type ProductVerdict = 'APPROVE' | 'REJECT';

export function isValidRejectionReason(note: string): boolean {
  return note.trim().length >= 10;
}

export function resolveVerdictPayload(verdict: ProductVerdict, note?: string) {
  return {
    p_verdict: verdict,
    p_public_note: note?.trim() || undefined,
  };
}

/** Shown when the attempt the queue displayed is decided or replaced by a newer submission. */
export const VERIFICATION_NOT_OPEN_MESSAGE =
  'Este envío ya fue resuelto o reemplazado por uno más reciente. Actualizamos la cola.';

/** True when fn_lock_product or fn_resolve_product_verdict refused an attempt that is not open. */
export function isVerificationNotOpen(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return (
    typeof message === 'string' && message.includes('VERIFICATION_NOT_OPEN')
  );
}
