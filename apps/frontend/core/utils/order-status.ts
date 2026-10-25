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
    case 'refunded':
    case 'dispute':
      return 'error';
    default:
      return 'textSecondary';
  }
};

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
