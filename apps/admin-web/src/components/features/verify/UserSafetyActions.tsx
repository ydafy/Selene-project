import { useState } from 'react';
import { ShieldCheck, Ban, RefreshCcw, UserX } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from 'sonner';
import { InputModal } from '../../ui/InputModal';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any;
  onUpdate: () => void;
}

export const UserSafetyActions = ({ user, onUpdate }: Props) => {
  const { user: admin } = useAuthStore();
  const [loading, setLoading] = useState(false);

  // ESTADO PARA EL MODAL
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    status?: 'active' | 'suspended' | 'banned';
  }>({ isOpen: false });

  const toggleVerified = async () => {
    setLoading(true);
    const nextValue = !user.is_verified_seller;
    const { error } = await supabase.rpc('fn_admin_toggle_verified_seller', {
      p_target_user_id: user.id,
      p_admin_id: admin?.id,
      p_is_verified: nextValue,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(nextValue ? 'Vendedor verificado' : 'Sello removido');
      onUpdate();
    }
    setLoading(false);
  };

  // 1. Esta función ahora solo abre el modal
  const handleOpenModal = (newStatus: 'active' | 'suspended' | 'banned') => {
    setModalConfig({ isOpen: true, status: newStatus });
  };

  // 2. Esta función ejecuta la RPC cuando el usuario confirma en el modal
  const handleConfirmStatusChange = async (reason: string) => {
    if (!modalConfig.status) return;

    setLoading(true);
    const { error } = await supabase.rpc('fn_admin_update_user_status', {
      p_target_user_id: user.id,
      p_admin_id: admin?.id,
      p_new_status: modalConfig.status,
      p_reason: reason,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Usuario marcado como ${modalConfig.status}`);
      onUpdate();
      setModalConfig({ isOpen: false }); // Cerramos el modal al éxito
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center gap-2 border-l border-white/10 pl-4 ml-4">
      {/* 1. BOTÓN SELLO AZUL (Se queda igual) */}
      <button
        onClick={toggleVerified}
        disabled={loading}
        className={`p-2 rounded-lg transition-all ${user.is_verified_seller ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-blue-light'}`}
      >
        <ShieldCheck size={18} />
      </button>

      {/* 2. BOTÓN DINÁMICO: SUSPENDER O REACTIVAR (FIXED) */}
      {user.status === 'active' ? (
        /* Si está activo, mostramos botón para SUSPENDER */
        <button
          onClick={() => handleOpenModal('suspended')} // <--- Ahora sí abre el modal correcto
          disabled={loading}
          title="Suspender Usuario"
          className="p-2 rounded-lg bg-white/5 text-blue-light hover:bg-fire/20 hover:text-fire transition-all"
        >
          <UserX size={18} />
        </button>
      ) : (
        /* Si NO está activo (banned o suspended), mostramos botón para REACTIVAR */
        <button
          onClick={() => handleOpenModal('active')} // <--- VITAL: Ahora pasa por el modal para definir el status
          disabled={loading}
          title="Reactivar Usuario e Inventario"
          className="p-2 rounded-lg bg-forest/20 text-forest hover:bg-forest/30 transition-all"
        >
          <RefreshCcw size={18} />
        </button>
      )}

      {/* 3. BOTÓN BANEAR (FIXED) */}
      <button
        onClick={() => handleOpenModal('banned')}
        disabled={loading || user.status === 'banned'}
        title="Banear Permanentemente"
        className={`p-2 rounded-lg transition-all ${user.status === 'banned' ? 'bg-fire text-night opacity-50' : 'bg-white/5 text-blue-light hover:bg-fire hover:text-night'}`}
      >
        <Ban size={18} />
      </button>

      {/* 4. EL MODAL (Se queda igual, ahora sí recibirá el status correcto) */}
      <InputModal
        isOpen={modalConfig.isOpen}
        onClose={() => setModalConfig({ isOpen: false })}
        onConfirm={handleConfirmStatusChange}
        isLoading={loading}
        title={
          modalConfig.status === 'active'
            ? 'Reactivar Cuenta'
            : modalConfig.status === 'banned'
              ? 'Banear Usuario'
              : 'Suspender Usuario'
        }
        description={
          modalConfig.status === 'active'
            ? 'Explica por qué estás devolviendo el acceso a este usuario. Sus productos HIDDEN volverán a ser VERIFIED.'
            : `Explica por qué estás cambiando el estado a ${modalConfig.status}.`
        }
        placeholder="Escribe el motivo aquí..."
        confirmLabel="Confirmar Cambio"
      />
    </div>
  );
};
