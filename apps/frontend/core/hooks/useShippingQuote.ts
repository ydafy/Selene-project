/**
 * @file core/hooks/useShippingQuote.ts
 * @description Hook para obtener cotizaciones de envío dinámicas.
 * Conectado a la Edge Function 'get-shipping-quote'.
 */

import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invokeEdge } from '../services/edge-client';
import { ShippingOption } from '@selene/types';
import { RequestRaceGuard } from '../utils/requestRaceGuard';

export const useShippingQuote = () => {
  const { t } = useTranslation('sell');
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const raceGuardRef = useRef(new RequestRaceGuard());

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

      const requestId = raceGuardRef.current.start();

      setIsQuoting(true);
      setError(null);

      try {
        const data = await invokeEdge('get-shipping-quote', {
          originZip,
          packageId,
          price,
          destinationZip: destinationZip || '06500', // CP pivote para cotización inicial
        });

        // Drop stale results when inputs changed before the request resolved.
        if (!raceGuardRef.current.isCurrent(requestId)) {
          return null;
        }

        const rates: ShippingOption[] = data?.rates || [];

        if (__DEV__) {
          console.info('[get-shipping-quote]', {
            packageId,
            priceCents: Math.round(price * 100),
            destinationZip: destinationZip || '06500',
            rates: rates.map((rate) => ({
              carrier: rate.carrier,
              service: rate.service,
              quoteCents: Math.round(rate.price * 100),
            })),
          });
        }

        if (rates.length === 0) {
          setError(t('errors.noCoverage'));
          return null;
        }

        return rates;
      } catch (e: unknown) {
        // Drop stale errors too.
        if (!raceGuardRef.current.isCurrent(requestId)) {
          return null;
        }

        const message = e instanceof Error ? e.message : String(e);
        console.error('[LOGÍSTICA ERROR]:', message);

        // User-friendly error mapping driven by i18n keys.
        if (message.includes('network') || message.includes('fetch')) {
          setError(t('errors.noConnection'));
        } else {
          setError(message || t('errors.quoteCalculationFailed'));
        }

        return null;
      } finally {
        // Only clear loading for the latest request.
        if (raceGuardRef.current.isCurrent(requestId)) {
          setIsQuoting(false);
        }
      }
    },
    [t],
  );

  return { getQuote, isQuoting, error };
};
