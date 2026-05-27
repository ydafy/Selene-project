/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from 'sonner';

interface LockStatus {
  isLockedByOther: boolean;
  lockerName: string | null;
  lockedSince: string | null;
}

export const useProductLock = () => {
  const { user } = useAuthStore();
  const [lockStatus, setLockStatus] = useState<LockStatus>({
    isLockedByOther: false,
    lockerName: null,
    lockedSince: null,
  });
  const [isLocking, setIsLocking] = useState(false);

  /**
   * Intenta adquirir el bloqueo del producto.
   * @returns Promise<boolean> True si el bloqueo es nuestro, False si es de otro.
   */
  const acquireLock = useCallback(
    async (productId: string): Promise<boolean> => {
      console.log(
        '[Lock] Intentando bloquear producto:',
        productId,
        'admin:',
        user?.id,
      );

      if (!user?.id || !productId) {
        console.warn('[Lock] No hay user o productId, cancelando');
        return false;
      }

      setIsLocking(true);
      try {
        console.log('[Lock] Llamando a RPC fn_lock_product...');
        const { data, error } = await supabase.rpc('fn_lock_product', {
          p_product_id: productId,
          p_admin_id: user.id,
        });

        console.log('[Lock] Respuesta RPC:', { data, error });

        if (error) {
          console.error('[Lock] Error de RPC:', error);
          throw error;
        }

        const result = data[0];
        console.log('[Lock] Result:', result);

        if (result.success) {
          setLockStatus({
            isLockedByOther: false,
            lockerName: null,
            lockedSince: null,
          });
          return true;
        } else {
          setLockStatus({
            isLockedByOther: true,
            lockerName: result.current_locker_name,
            lockedSince: result.locked_since,
          });
          toast.warning(
            `Acceso denegado: Producto en revisión por ${result.current_locker_name}`,
          );
          return false;
        }
      } catch (err: any) {
        console.error('[Lock] Error al adquirir bloqueo:', err.message);
        toast.error('Error de conexión al intentar bloquear el producto');
        return false;
      } finally {
        setIsLocking(false);
      }
    },
    [user?.id],
  );

  const releaseLock = useCallback(
    async (productId: string) => {
      console.log('[Lock] Liberando producto:', productId);

      if (!user?.id || !productId) return;
      try {
        const { data, error } = await supabase.rpc('fn_unlock_product', {
          p_product_id: productId,
          p_admin_id: user.id,
        });

        console.log('[Lock] Unlock response:', { data, error });

        setLockStatus({
          isLockedByOther: false,
          lockerName: null,
          lockedSince: null,
        });
      } catch (err: any) {
        console.error('[Lock] Error al liberar bloqueo:', err.message);
      }
    },
    [user?.id],
  );

  return {
    acquireLock,
    releaseLock,
    lockStatus,
    isLocking,
  };
};
