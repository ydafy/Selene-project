import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuthContext } from '../../auth/AuthProvider';
import { supabase } from '../../../core/db/supabase';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Notification } from '@selene/types';
import { useTranslation } from 'react-i18next';

export const NotificationWatcher = () => {
  const { session } = useAuthContext();
  const router = useRouter();
  const { t } = useTranslation('common');

  // ESTADO: Ahora es un Array (Cola)
  const [queue, setQueue] = useState<Notification[]>([]);

  // Obtenemos la notificación actual (la primera de la fila)
  const currentNotification = queue.length > 0 ? queue[0] : null;
  const isLast = queue.length === 1;

  const checkNotifications = async () => {
    if (!session?.user.id) return;

    // 1. Traemos TODAS las no leídas
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('read', false)
      .order('created_at', { ascending: false }); // Las más nuevas primero

    if (data && data.length > 0) {
      setQueue(data as Notification[]);
    }
  };

  useEffect(() => {
    if (session) {
      checkNotifications();
    }
  }, [session]);

  // Lógica para avanzar en la cola
  const handleNext = async () => {
    if (!currentNotification) return;

    // A. Marcar la actual como leída en DB
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', currentNotification.id);

    // B. Actualizar estado local (Quitar la primera)
    setQueue((prev) => prev.slice(1));
  };

  // Lógica para el último elemento (Navegar)
  const handleFinalAction = async () => {
    if (!currentNotification) return;

    // 1. Marcar como leída
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', currentNotification.id);

    // 2. Navegar
    if (currentNotification.action_path) {
      if (currentNotification.action_path === '/profile') {
        router.push('/profile/listings');
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.push(currentNotification.action_path as any);
      }
    }

    // 3. Limpiar cola
    setQueue([]);
  };

  // Handler Principal del Botón
  const onConfirmPress = () => {
    if (isLast) {
      handleFinalAction();
    } else {
      handleNext();
    }
  };

  // Handler para "Cerrar Todo" (Botón secundario)
  const handleDismissAll = async () => {
    // Opcional: Podríamos marcar todas como leídas, o solo cerrar el dialog visualmente.
    // Por ahora solo cerramos visualmente para no perder info si el usuario se arrepiente.
    setQueue([]);
  };

  if (!currentNotification) return null;

  // Lógica de UI Dinámica
  const isError = currentNotification.type === 'error';

  // Texto del botón
  let buttonLabel = t('dialog.next');
  if (isLast) {
    buttonLabel = isError ? t('dialog.fixNow') : t('dialog.goToMyPosts');
  }

  return (
    <ConfirmDialog
      visible={!!currentNotification}
      title={currentNotification.title}
      description={currentNotification.message}
      onConfirm={onConfirmPress}
      onCancel={handleDismissAll}
      confirmLabel={buttonLabel}
      cancelLabel={isLast ? t('dialog.cancel') : t('dialog.skipAll')}
      hideCancel={false}
      // El icono y color cambian según el mensaje actual
      icon={isError ? 'alert-circle-outline' : 'check-circle-outline'}
      isDangerous={isError}
    />
  );
};
