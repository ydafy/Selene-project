import React, { useEffect, useState } from 'react';
import { useAuthContext } from '../../auth/AuthProvider';
import { supabase } from '../../../core/db/supabase';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Notification } from '@selene/types';

/**
 * Este componente no renderiza nada visualmente en el layout,
 * pero monitorea notificaciones no leídas y muestra un Dialog si encuentra una.
 */
export const NotificationWatcher = () => {
  const { session } = useAuthContext();
  const [notification, setNotification] = useState<Notification | null>(null);

  // Función para buscar notificaciones no leídas
  const checkNotifications = async () => {
    if (!session?.user.id) return;

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('read', false)
      .order('created_at', { ascending: false }) // La más reciente primero
      .limit(1)
      .single();

    if (!error && data) {
      setNotification(data as Notification);
    }
  };

  // Checar al montar (cuando abre la app o hace login)
  useEffect(() => {
    if (session) {
      checkNotifications();

      // Opcional: Suscribirse a cambios en tiempo real (Realtime)
      // Para MVP, checar al inicio es suficiente y ahorra recursos.
    }
  }, [session]);

  const handleDismiss = async () => {
    if (!notification) return;

    // 1. Marcar como leída en DB
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notification.id);

    // 2. Limpiar estado local
    setNotification(null);
  };

  if (!notification) return null;

  return (
    <ConfirmDialog
      visible={!!notification}
      title={notification.title}
      description={notification.message}
      onConfirm={handleDismiss}
      onCancel={handleDismiss}
      confirmLabel="Entendido"
      hideCancel={true} // Solo informativo
      icon={
        notification.type === 'error'
          ? 'alert-circle-outline'
          : notification.type === 'success'
            ? 'check-circle-outline'
            : 'information-outline'
      }
      isDangerous={notification.type === 'error'}
    />
  );
};
