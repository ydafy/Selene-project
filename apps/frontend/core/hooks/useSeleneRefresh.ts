/**
 * @file core/hooks/useSeleneRefresh.ts
 * @description Gestiona la coreografía de refresco: Spinner -> Skeleton -> Data.
 */

import { useState, useCallback } from 'react';

export const useSeleneRefresh = (refetch: () => Promise<any>) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);

    // Disparamos la petición a la DB
    await refetch();

    // Handoff: Quitamos el spinner nativo de inmediato para que entren los skeletons
    setIsRefreshing(false);
  }, [refetch]);

  return {
    isRefreshing,
    onRefresh,
  };
};
