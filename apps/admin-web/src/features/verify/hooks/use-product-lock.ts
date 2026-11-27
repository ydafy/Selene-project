import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase';
import { useAuthStore } from '@/shared/store/use-auth-store';
import { toast } from 'sonner';
import {
  VERIFICATION_NOT_OPEN_MESSAGE,
  isVerificationNotOpen,
} from '../logic/resolve-verdict';

interface LockStatus {
  isLockedByOther: boolean;
  lockerName: string | null;
  lockedSince: string | null;
}

export const useProductLock = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const adminIdRef = useRef<string | null>(null);
  const [lockStatus, setLockStatus] = useState<LockStatus>({
    isLockedByOther: false,
    lockerName: null,
    lockedSince: null,
  });
  const [isLocking, setIsLocking] = useState(false);

  // The attempt the queue showed was decided or replaced: refresh the queue.
  const reportNotOpen = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['pending-products'] });
    toast.warning(VERIFICATION_NOT_OPEN_MESSAGE);
  }, [queryClient]);

  /**
   * Intenta adquirir el bloqueo del intento de verificación que muestra la cola.
   * @returns Promise<boolean> True si el bloqueo es nuestro, False si es de otro.
   */
  const acquireLock = useCallback(
    async (productId: string, verificationId: string): Promise<boolean> => {
      if (!user?.id || !productId || !verificationId) {
        return false;
      }

      setIsLocking(true);
      try {
        const { data, error } = await supabase.rpc('fn_lock_product', {
          p_product_id: productId,
          p_verification_id: verificationId,
        });

        if (error) {
          if (isVerificationNotOpen(error)) {
            reportNotOpen();
            return false;
          }
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
            lockerName: result.locked_by_username,
            lockedSince: result.locked_at,
          });
          toast.warning(
            `Acceso denegado: Producto en revisión por ${result.locked_by_username}`,
          );
          return false;
        }
      } catch (err: unknown) {
        const message =
          (err as { message?: string })?.message ??
          (err as { error_description?: string })?.error_description ??
          'Error desconocido';
        toast.error(`Error de conexión: ${message}`);
        console.error('[useProductLock]', err);
        return false;
      } finally {
        setIsLocking(false);
      }
    },
    [user, reportNotOpen],
  );

  const releaseLock = useCallback(async (productId: string) => {
    if (!adminIdRef.current || !productId) return;
    try {
      await supabase.rpc('fn_unlock_product', {
        p_product_id: productId,
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
  }, []);

  return {
    acquireLock,
    releaseLock,
    lockStatus,
    isLocking,
  };
};
