import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

/** Refreshes persisted status only; the caller owns diagnostics, never purchases. */
export function useShipmentLabelRefresh(
  shipmentId: string | undefined,
  refresh: () => Promise<unknown>,
): void {
  useFocusEffect(
    useCallback(() => {
      if (!shipmentId) return;
      let active = true;
      let pending = false;
      let queued = false;
      let previousState = AppState.currentState;

      const run = () => {
        if (!active) return;
        if (pending) {
          queued = true;
          return;
        }
        pending = true;
        void Promise.resolve()
          .then(() => (active ? refresh() : undefined))
          .catch(() => undefined)
          .finally(() => {
            pending = false;
            if (active && queued) {
              queued = false;
              run();
            }
          });
      };

      run();
      const subscription = AppState.addEventListener('change', (state) => {
        const resumed = state === 'active' && previousState !== 'active';
        previousState = state;
        if (resumed) run();
      });
      return () => {
        active = false;
        subscription.remove();
      };
    }, [shipmentId, refresh]),
  );
}
