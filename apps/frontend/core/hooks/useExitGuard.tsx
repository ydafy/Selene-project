import React, { useState, useCallback, useRef } from 'react';

import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'; // Ajusta la ruta si es necesario
import { useSellStore } from '../store/useSellStore';
import { routeBlockedRemove } from '../utils/navigationGuard';

export const useExitGuard = (enabled: boolean = true) => {
  const [showDialog, setShowDialog] = useState(false);
  const navigation = useNavigation();
  const { t } = useTranslation('common');
  const { resetDraft } = useSellStore();

  // La acción bloqueada se guarda para repetirla si el usuario confirma
  const pendingAction = useRef<
    Parameters<typeof navigation.dispatch>[0] | null
  >(null);

  usePreventRemove(enabled, ({ data }) => {
    // Si es una acción de "Replace" (como cuando publicamos exitosamente), dejamos pasar;
    // el resto guarda la acción y muestra el diálogo
    routeBlockedRemove(data.action, {
      proceed: (action) => navigation.dispatch(action),
      confirmExit: (action) => {
        pendingAction.current = action;
        setShowDialog(true);
      },
    });
  });

  const handleConfirm = useCallback(() => {
    setShowDialog(false);

    const action = pendingAction.current;
    if (!action) return;
    pendingAction.current = null;

    resetDraft(); // Limpiamos el store porque el usuario decidió salir
    navigation.dispatch(action);
  }, [navigation, resetDraft]);

  const handleCancel = useCallback(() => {
    setShowDialog(false);
    pendingAction.current = null;
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
