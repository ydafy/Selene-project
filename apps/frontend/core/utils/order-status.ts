import { Theme } from '../theme';
import { OrderStatus } from '@selene/types';

/**
 * Mapea el estado de la orden a un color del tema.
 */
export const getOrderStatusColor = (
  status: OrderStatus,
): keyof Theme['colors'] => {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'paid':
      return 'paid';
    case 'preparing':
      return 'preparing';
    case 'shipped':
      return 'shipped';
    case 'delivered':
      return 'delivered';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'dispute':
      return 'dispute';
    default:
      return 'textSecondary';
  }
};

// These state colors are too dark for small text on the dark badge (about 2:1),
// so their label uses primary text while the border, bar, and dot keep the state color.
const LOW_CONTRAST_STATES: OrderStatus[] = ['cancelled', 'refunded', 'dispute'];

/**
 * Color for the status label text, legible on the dark badge background.
 */
export const getOrderStatusTextColor = (
  status: OrderStatus,
): keyof Theme['colors'] =>
  LOW_CONTRAST_STATES.includes(status)
    ? 'textPrimary'
    : getOrderStatusColor(status);

/**
 * Obtiene la clave de traducción para el estado.
 */
export const getOrderStatusLabel = (status: OrderStatus) => {
  return `status.${status}`;
};

/**
 * Determina si una orden requiere acción inmediata del vendedor.
 */
export const requiresSellerAction = (status: OrderStatus): boolean => {
  return status === 'paid'; // Solo cuando está pagada y falta la guía
};
