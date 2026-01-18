import React, { useState, useEffect, useCallback } from 'react';

import { useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'; // Ajusta la ruta si es necesario
import { useSellStore } from '../store/useSellStore';

export const useExitGuard = (enabled: boolean = true) => {
  const [showDialog, setShowDialog] = useState(false);
  const navigation = useNavigation();
  const router = useRouter();
  const { t } = useTranslation('common');
  const { resetDraft } = useSellStore();

  // Guardamos la acción de navegación pendiente para ejecutarla si el usuario confirma
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pendingAction, setPendingAction] = useState<any>(null);

  useEffect(() => {
    if (!enabled) return;

    const beforeRemoveListener = navigation.addListener('beforeRemove', (e) => {
      // Si es una acción de "Replace" (como cuando publicamos exitosamente), dejamos pasar
      if (e.data.action.type === 'REPLACE') return;

      // Prevenimos la navegación por defecto
      e.preventDefault();

      // Guardamos la acción y mostramos el diálogo
      setPendingAction(e.data.action);
      setShowDialog(true);
    });

    return () => {
      navigation.removeListener('beforeRemove', beforeRemoveListener);
    };
  }, [navigation, enabled]);

  const handleConfirm = useCallback(() => {
    setShowDialog(false);
    resetDraft(); // Limpiamos el store porque el usuario decidió salir

    if (pendingAction) {
      navigation.dispatch(pendingAction);
    } else {
      // Fallback si no hay acción pendiente (ej. botón físico Android en casos raros)
      router.back();
    }
  }, [pendingAction, navigation, router, resetDraft]);

  const handleCancel = useCallback(() => {
    setShowDialog(false);
    setPendingAction(null);
  }, []);

  // Retornamos el componente renderizable
  const ExitDialog = () => (
    <ConfirmDialog
      visible={showDialog}
      title={t('dialog.discardTitle', '¿Descartar publicación?')}
      description={t(
        'dialog.discardDescription',
        'Si sales ahora, perderás toda la información ingresada.',
      )}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      confirmLabel={t('actions.discard', 'Descartar')}
      cancelLabel={t('actions.continue', 'Continuar editando')}
      isDangerous={true}
      icon="alert-circle-outline"
    />
  );

  return { ExitDialog };
};
