import type { Enums, Tables } from '@selene/types';

/** Same wording as the app's report dialog (frontend `product.report.reasons`, es). */
export const REPORT_REASON_LABELS: Record<Enums<'report_reason'>, string> = {
  fraud: 'Fraude o estafa',
  counterfeit_or_misdescribed: 'Falsificado o no coincide con la descripción',
  prohibited_item: 'Artículo prohibido',
  offensive_content: 'Contenido ofensivo',
  harassment: 'Acoso',
  spam: 'Spam',
  other: 'Otro',
};

const REPORT_OUTCOME_LABELS: Record<Enums<'report_outcome'>, string> = {
  dismissed: 'descartada',
  warned: 'usuario advertido',
  listing_removed: 'publicación retirada',
  account_suspended: 'cuenta suspendida',
};

export const reportReasonLabel = (reason: Enums<'report_reason'>) =>
  REPORT_REASON_LABELS[reason];

/** "Abierta", or "Resuelta: <outcome>" once an admin resolved it. */
export function reportStatusLabel(
  report: Pick<Tables<'reports'>, 'status' | 'outcome'>,
): string {
  if (report.status === 'open') return 'Abierta';
  return report.outcome
    ? `Resuelta: ${REPORT_OUTCOME_LABELS[report.outcome]}`
    : 'Resuelta';
}
