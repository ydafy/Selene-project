/**
 * @file core/hooks/useShippingQuote.ts
 * @description Hook para obtener cotizaciones de envío dinámicas.
 * Conectado a la Edge Function 'get-shipping-quote'.
 */

import { useState, useCallback } from 'react';
import { supabase } from '../db/supabase';
import { ShippingOption } from '@selene/types';

export const useShippingQuote = () => {
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Solicita una cotización real a la infraestructura de logística.
   *
   * @param originZip - CP de origen (Vendedor).
   * @param packageId - ID del preset de empaque (ej. 'gpu_1').
   * @param price - Valor declarado para el seguro.
   * @param destinationZip - CP de destino (opcional, default CDMX para estimados).
   */
  const getQuote = useCallback(
    async (
      originZip: string,
      packageId: string,
      price: number,
      destinationZip?: string,
    ): Promise<ShippingOption[] | null> => {
      // Guardias de seguridad iniciales
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
              destinationZip: destinationZip || '06500', // CP pivote para cotización inicial
            },
          },
        );

        // Manejo de errores de la Edge Function (4xx, 5xx)
        if (funcError) {
          const status = funcError.status;
          if (status === 422)
            throw new Error('Datos de envío inválidos (CP incorrecto).');
          if (status === 502)
            throw new Error('El servicio de paquetería no está disponible.');
          throw funcError;
        }

        const rates: ShippingOption[] = data?.rates || [];

        if (rates.length === 0) {
          setError('No hay cobertura para esta ruta actualmente.');
          return null;
        }

        return rates;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[LOGÍSTICA ERROR]:', message);

        // Mapeo de errores amigables para el usuario
        if (message.includes('network') || message.includes('fetch')) {
          setError('Sin conexión. Revisa tu internet.');
        } else {
          setError(message || 'Error al calcular el envío.');
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
