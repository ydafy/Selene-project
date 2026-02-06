import { useState, useCallback } from 'react';
import { supabase } from '../db/supabase';
import { ShippingOption } from '@selene/types';

/**
 * Hook para obtener cotización de envío (Estafeta-Only para MVP)
 */
export const useShippingQuote = () => {
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Obtiene la cotización de Estafeta incluyendo seguro basado en el precio.
   * @param originZip CP del vendedor
   * @param packageId ID del paquete (gpu_1, cpu_1, etc.)
   * @param price Precio del producto (para el seguro)
   * @param destinationZip CP del comprador (opcional)
   */
  const getQuote = useCallback(
    async (
      originZip: string,
      packageId: string,
      price: number,
      destinationZip?: string,
    ): Promise<ShippingOption[] | null> => {
      if (!originZip || !packageId || !price) return null;

      setIsQuoting(true);
      setError(null);

      try {
        const { data, error: funcError } = await supabase.functions.invoke(
          'get-shipping-quote',
          {
            body: {
              originZip,
              packageId,
              price,
              destinationZip: destinationZip || null,
            },
          },
        );

        if (funcError) throw funcError;

        // La Edge Function ahora devuelve { rates: [ { carrier: 'estafeta', ... } ] }
        const rates: ShippingOption[] = data?.rates || [];

        if (rates.length === 0) {
          console.warn(
            '[QUOTE] No se encontraron tarifas de Estafeta para esta ruta.',
          );
          return null;
        }

        return rates;
      } catch (e: unknown) {
        console.error('Error en useShippingQuote:', e);
        const error = e as Error;
        const msg = error.message || '';
        if (msg.includes('network') || msg.includes('fetch')) {
          setError('Error de conexión. Revisa tu internet.');
        } else {
          setError('No se pudo calcular el envío.');
        }

        return null;
      } finally {
        setIsQuoting(false);
      }
    },
    [],
  );

  return { getQuote, isQuoting, error };
};
