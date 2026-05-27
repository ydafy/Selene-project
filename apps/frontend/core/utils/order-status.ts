import { Theme } from '../theme';
import { OrderStatus } from '@selene/types';

/**
 * Mapea el estado de la orden a un color del tema.
 */
export const getOrderStatusColor = (
  status: OrderStatus,
): keyof Theme['colors'] => {
  switch (status) {
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
 * Obtiene el color de fondo sutil para el badge (15% opacidad aprox)
 */
export const getOrderStatusBgColor = (status: OrderStatus): string => {
  const colors: Record<OrderStatus, string> = {
    pending: '#A9924C',
    paid: '#5C85AD',
    preparing: '#7866A3',
    shipped: '#336084',
    delivered: '#478560',
    completed: '#319B5B',
    cancelled: '#6A3939',
    refunded: '#6A4D39',
    dispute: '#782B2B',
  };
  return colors[status] || 'rgba(255, 255, 255, 0.1)';
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
