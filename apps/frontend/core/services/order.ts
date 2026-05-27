/**
 * @file core/services/OrderService.ts
 * @description Servicios de orquestación para el ciclo de vida de las órdenes.
 * Incluye validaciones de integridad de stock antes de iniciar procesos de pago.
 */

import { supabase } from '../db/supabase';

export class OrderService {
  /**
   * Valida la disponibilidad de una lista de productos.
   * Devuelve los IDs de los productos que ya no están disponibles para venta.
   */
  static async validateProductStock(productIds: string[]): Promise<{
    isValid: boolean;
    unavailableIds: string[];
    errorCode?: 'EMPTY_CART' | 'DATABASE_ERROR' | 'STOCK_CONFLICT';
  }> {
    try {
      if (!productIds || productIds.length === 0)
        return { isValid: false, unavailableIds: [], errorCode: 'EMPTY_CART' };

      const { data: products, error } = await supabase
        .from('products')
        .select('id, status')
        .in('id', productIds)
        .is('deleted_at', null);

      if (error) throw error;

      // Detectamos cuáles IDs del carrito no están en la respuesta (borrados)
      // o no están en estado VERIFIED.
      const validIds = new Set(
        products?.filter((p) => p.status === 'VERIFIED').map((p) => p.id) || [],
      );
      const unavailableIds = productIds.filter((id) => !validIds.has(id));

      return {
        isValid: unavailableIds.length === 0,
        unavailableIds,
        errorCode: unavailableIds.length > 0 ? 'STOCK_CONFLICT' : undefined,
      };
    } catch (error) {
      console.error('[OrderService] Error en validateProductStock:', error);
      return {
        isValid: false,
        unavailableIds: [],
        errorCode: 'DATABASE_ERROR',
      };
    }
  }
}
