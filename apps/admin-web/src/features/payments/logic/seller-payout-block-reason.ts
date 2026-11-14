/**
 * Codes `admin_connect_payout_release_view.seller_payout_block_reason` emits:
 * the seller's onboarding state, then the Connect account gate's
 * `blocked_reason`. The column is plain text, so a gate code added later
 * reaches this screen as an unknown string and still has to show.
 */
const SELLER_PAYOUT_BLOCK_REASONS = [
  'onboarding_rejected',
  'onboarding_pending',
  'payouts_disabled',
  'payouts_schedule_not_manual',
  'errored',
  'verification_failed',
  'tokenized_account_number_deactivated',
  'destination_undetermined',
  'account_refresh_pending',
  'account_not_actionable',
] as const;

type SellerPayoutBlockReason = (typeof SELLER_PAYOUT_BLOCK_REASONS)[number];

const isKnownReason = (code: string): code is SellerPayoutBlockReason =>
  (SELLER_PAYOUT_BLOCK_REASONS as readonly string[]).includes(code);

const genericLabel = (code: string) => `La cuenta no puede cobrar (${code})`;

function knownReasonLabel(code: SellerPayoutBlockReason): string {
  switch (code) {
    case 'onboarding_rejected':
      return 'Stripe rechazó el registro del vendedor';
    case 'onboarding_pending':
      return 'Registro de Stripe incompleto';
    case 'payouts_disabled':
      return 'Stripe deshabilitó los pagos';
    case 'payouts_schedule_not_manual':
      return 'Pagos de la cuenta no están en manual';
    case 'errored':
    case 'verification_failed':
    case 'tokenized_account_number_deactivated':
      return 'Cuenta bancaria con error';
    case 'destination_undetermined':
      return 'Cuenta bancaria sin confirmar';
    case 'account_refresh_pending':
      return 'Verificando la cuenta con Stripe';
    case 'account_not_actionable':
      return genericLabel(code);
    default: {
      const unhandled: never = code;
      return genericLabel(unhandled);
    }
  }
}

/** Plain-Spanish reason why Stripe cannot pay the seller's account. */
export function sellerPayoutBlockReasonLabel(code: string): string {
  return isKnownReason(code) ? knownReasonLabel(code) : genericLabel(code);
}

/** How long a completed shipment's payout has been held by Selene. */
export function daysHeldLabel(days: number): string {
  if (days <= 0) return 'Completado hoy';
  return `Retenido hace ${days} ${days === 1 ? 'día' : 'días'}`;
}
