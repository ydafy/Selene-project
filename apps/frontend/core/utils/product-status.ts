import { ProductStatus } from '@selene/types';
import { Theme } from '../theme';

/**
 * Mapea el estado del producto a un color del tema.
 * @param status - El estado del producto (VERIFIED, SOLD, etc.)
 * @returns El nombre del color en el tema (primary, success, error, etc.)
 */
export const getStatusColor = (
  status: ProductStatus,
): keyof Theme['colors'] => {
  switch (status) {
    case 'VERIFIED':
      return 'success'; // Verde: Aprobado y seguro

    case 'IN_REVIEW':
      return 'primary'; // Dorado: En proceso activo (Atención)

    case 'PENDING_VERIFICATION':
      return 'textSecondary'; // Gris/Azul: Falta acción del usuario (Estado pasivo)

    case 'SOLD':
      return 'cardBackground'; // Gris Oscuro: Ya no está disponible (Discreto)

    case 'REJECTED':
      return 'error'; // Rojo: Hubo un problema

    default:
      return 'textSecondary'; // Fallback seguro
  }
};

/**
 * (Opcional) Helper para obtener la clave de traducción del estado
 */
export const getStatusTranslationKey = (status: string) => {
  return `listings.status.${status}`;
};

/**
 * Determina si un producto pertenece al historial (ya no está activo).
 * Se considera historial si está Vendido o Rechazado.
 */
export const isProductHistory = (status: ProductStatus): boolean => {
  return status === 'SOLD' || status === 'REJECTED';
};
