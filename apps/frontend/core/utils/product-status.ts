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
): boolean => {
  if (!status) return false;
  // Los estados que ya no están a la venta pero se guardan para registro
  const historyStatuses = ['SOLD', 'REJECTED', 'HIDDEN'];
  return historyStatuses.includes(status);
};
