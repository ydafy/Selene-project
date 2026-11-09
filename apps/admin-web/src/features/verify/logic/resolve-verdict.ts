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
