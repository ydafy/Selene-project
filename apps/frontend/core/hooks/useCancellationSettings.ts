import { useMemo } from 'react';

import { useSystemConfig } from './useSystemConfig';
import {
  resolveCancellationSettings,
  type CancellationSettings,
} from './cancellation-settings';

export {
  CANCELLATION_SETTINGS_FALLBACKS,
  resolveCancellationSettings,
} from './cancellation-settings';
export type { CancellationSettings } from './cancellation-settings';

export function useCancellationSettings(): CancellationSettings {
  const { data: systemSettings } = useSystemConfig();

  return useMemo(
    () => resolveCancellationSettings(systemSettings ?? null),
    [systemSettings],
  );
}
