import React, { useState, useCallback, useRef } from 'react';

import { usePreventRemove } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../ui/feedback/confirm-dialog'; // Ajusta la ruta si es necesario
import { routeBlockedRemove } from '../utils/navigation-guard';

type ExitGuardOptions = {
  enabled?: boolean;
  /** Runs when the user confirms leaving, right before the blocked action replays. */
  onDiscard: () => void;
};

export const useExitGuard = ({
  enabled = true,
  onDiscard,
}: ExitGuardOptions) => {
  const [showDialog, setShowDialog] = useState(false);
  const { t } = useTranslation('common');

  // repeat() apaga la prevención y repite la acción bloqueada; se guarda para
  // llamarla si el usuario confirma. Despachar la acción a mano no alcanza: con
  // la prevención activa, SDK 58 la volvería a bloquear.
  const pendingRepeat = useRef<(() => void) | null>(null);

  usePreventRemove(enabled, ({ data, repeat }) => {
    // Si es una acción de "Replace" (como cuando publicamos exitosamente), dejamos pasar;
    // el resto guarda la acción y muestra el diálogo
    routeBlockedRemove(data.action, {
      proceed: () => repeat(),
      confirmExit: () => {
        pendingRepeat.current = repeat;
        setShowDialog(true);
      },
    });
  });

  const handleConfirm = useCallback(() => {
    setShowDialog(false);

    const repeat = pendingRepeat.current;
    if (!repeat) return;
    pendingRepeat.current = null;

    onDiscard(); // El usuario decidió salir: el llamador descarta su estado
    repeat();
  }, [onDiscard]);

  const handleCancel = useCallback(() => {
    setShowDialog(false);
    pendingRepeat.current = null;
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
