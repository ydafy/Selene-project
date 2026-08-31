/**
 * @file components/features/notifications/dialogActions.ts
 * @description Pure helper that decides which labels/actions a notification dialog
 * should expose based on the queue state.
 */

export type DialogConfirmAction = 'action' | 'skipAll';
export type DialogCancelAction = 'cancel' | 'skip';

export interface DialogControlPlan {
  confirmAction: DialogConfirmAction;
  cancelAction: DialogCancelAction;
}

/**
 * When only one notification remains, the dialog offers the primary action
 * (open/fix/understood) and a Cancel button. When more than one notification
 * is queued, the dialog offers Skip all (confirm) and Skip (cancel).
 */
export function resolveDialogControls(isLast: boolean): DialogControlPlan {
  return {
    confirmAction: isLast ? 'action' : 'skipAll',
    cancelAction: isLast ? 'cancel' : 'skip',
  };
}
