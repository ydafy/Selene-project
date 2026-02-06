import { supabase } from '../db/supabase';
import { Product } from '@selene/types';

/**
 * Servicios relacionados con las órdenes y productos para el checkout.
 */
export class OrderService {
  /**
   * Valida que todos los productos del carrito estén disponibles (VERIFIED)
   * @param productIds - Array de IDs de productos a validar
   * @returns Promise<boolean> - true si todos están disponibles
   */
  static async validateProductStock(productIds: string[]): Promise<{
    isValid: boolean;
    unavailableItem?: Product['name'];
  }> {
    try {
      const { data: products, error } = await supabase
        .from('products')
        .select('id, name, status')
        .in('id', productIds);

      if (error) throw error;

      const unavailableItem = products?.find((p) => p.status !== 'VERIFIED');

      if (unavailableItem) {
        return {
          isValid: false,
          unavailableItem: unavailableItem.name,
        };
      }

      return { isValid: true };
    } catch (error) {
      console.error('Error en validateProductStock:', error);
      throw new Error('No se pudo validar la disponibilidad de los productos.');
    }
  }
}
