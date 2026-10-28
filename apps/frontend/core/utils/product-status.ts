import { Theme } from '../theme';

/**
 * Devuelve el color del tema asociado al estado del producto.
 * Acepta string para sincronía con la DB.
 */
export const getStatusColor = (
  status: string | null | undefined,
): keyof Theme['colors'] => {
  if (!status) return 'textSecondary';

  const statusMap: Record<string, keyof Theme['colors']> = {
    VERIFIED: 'success',
    PENDING_VERIFICATION: 'warning',
    REJECTED: 'error',
    SOLD: 'primary',
    RESERVED: 'warning',
    HIDDEN: 'textSecondary',
    IN_REVIEW: 'warning',
    IN_DISPUTE: 'warning',
    ACCOUNT_HOLD: 'warning',
  };

  return statusMap[status] || 'textSecondary';
};

/**
 * (Opcional) Helper para obtener la clave de traducción del estado
 */
export const getStatusTranslationKey = (status: string) => {
  return `listings.status.${status}`;
};

/**
 * Determina si un estado de producto pertenece al historial (no activo).
 */
export const isProductHistory = (
  status: string | null | undefined,
  statusBeforeAccountHold?: string | null,
): boolean => {
  if (!status) return false;
  if (isAccountHeld({ status, status_before_account_hold: statusBeforeAccountHold })) {
    return false;
  }
  // Los estados que ya no están a la venta pero se guardan para registro
  const historyStatuses = ['SOLD', 'REJECTED', 'HIDDEN'];
  return historyStatuses.includes(status);
};

/**
 * A listing hidden by its seller's account suspension. The server records the prior status in
 * `status_before_account_hold` and restores it on reactivation, so it is not history; the owner
 * cannot edit or delete it while the account is suspended.
 */
export const isAccountHeld = (product: {
  status: string | null | undefined;
  status_before_account_hold?: string | null;
}): boolean => product.status === 'HIDDEN' && !!product.status_before_account_hold;
