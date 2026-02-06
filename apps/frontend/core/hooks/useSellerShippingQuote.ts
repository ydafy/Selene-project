import { useState, useCallback } from 'react';
import { supabase } from '../db/supabase';

/**
 * Hook exclusivo para el flujo de venta.
 * Obtiene una cotización de referencia con Estafeta para que el vendedor sepa su costo.
 */
export const useSellerShippingQuote = () => {
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getQuote = useCallback(async (originZip: string, packageId: string) => {
    if (!originZip || !packageId) return null;

    setIsQuoting(true);
    setError(null);
    try {
      console.log('[SELLER QUOTE] Solicitando cotización...');
      const { data, error: funcError } = await supabase.functions.invoke(
        'get-shipping-quote-seller',
        {
          body: {
            originZip,
            packageId,
          },
        },
      );

      if (funcError) throw funcError;
      return data?.price || null;
    } catch (e: unknown) {
      console.error('[SELLER QUOTE] Error:', e);
      setError(
        'No se pudo cotizar el envío. Revisa el código postal e intenta de nuevo.',
      );
      return null;
    } finally {
      setIsQuoting(false);
    }
  }, []);

  return { getQuote, isQuoting, error };
};
