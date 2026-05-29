import { useState, useCallback, useRef } from 'react';
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
  const adminIdRef = useRef<string | null>(null);
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
      if (!user?.id || !productId) {
        return false;
      }

      setIsLocking(true);
      try {
        const { data, error } = await supabase.rpc('fn_lock_product', {
          p_product_id: productId,
          p_admin_id: user.id,
        });

        if (error) {
          throw error;
        }

        const result = data[0];

        if (result.success) {
          adminIdRef.current = user.id;
          setLockStatus({
            isLockedByOther: false,
            lockerName: null,
            lockedSince: null,
          });
          return true;
        } else {
          setLockStatus({
            isLockedByOther: true,
            lockerName: result.locker_name,
            lockedSince: result.locked_at,
          });
          toast.warning(
            `Acceso denegado: Producto en revisión por ${result.locker_name}`,
          );
          return false;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        toast.error(`Error de conexión: ${message}`);
        return false;
      } finally {
        setIsLocking(false);
      }
    },
    [user?.id],
  );

  const releaseLock = useCallback(
    async (productId: string) => {
      if (!adminIdRef.current || !productId) return;
      try {
        await supabase.rpc('fn_unlock_product', {
          p_product_id: productId,
          p_admin_id: adminIdRef.current,
        });

        setLockStatus({
          isLockedByOther: false,
          lockerName: null,
          lockedSince: null,
        });
        adminIdRef.current = null;
      } catch {
        // Lock release failed silently — lock will expire after 10 min
      }
    },
    [],
  );

  return {
    acquireLock,
    releaseLock,
    lockStatus,
    isLocking,
  };
};
