import { useMemo } from 'react';

import { useSystemConfig } from '../../../shared/hooks/use-system-config';
import {
  resolveCancellationSettings,
  type CancellationSettings,
} from '../logic/cancellation-settings';

export type { CancellationSettings } from '../logic/cancellation-settings';

export function useCancellationSettings(): CancellationSettings {
  const { data: systemSettings } = useSystemConfig();

  return useMemo(
    () => resolveCancellationSettings(systemSettings ?? null),
    [systemSettings],
  );
}
