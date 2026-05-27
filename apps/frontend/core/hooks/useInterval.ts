/**
 * @file core/hooks/useInterval.ts
 * @description Hook robusto para manejar intervalos en React,
 * evitando problemas de cierres (closures) y re-renderizados.
 */

import { useEffect, useRef } from 'react';

export const useInterval = (callback: () => void, delay: number | null) => {
  const savedCallback = useRef(callback);

  // Recordar el último callback si cambia
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Configurar el intervalo
  useEffect(() => {
    if (delay !== null) {
      const id = setInterval(() => savedCallback.current(), delay);
      return () => clearInterval(id);
    }
  }, [delay]);
};
