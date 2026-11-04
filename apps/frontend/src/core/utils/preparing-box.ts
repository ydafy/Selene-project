import type { PackagePreset } from '../hooks/useSystemConfig';

/** Mirrors FALLBACK_PACKAGE_PRESET in the generate-shipping-label Edge Function. */
export const FALLBACK_PACKAGE_PRESET = 'mobo_1';

export type PreparingBox =
  | { status: 'preset' | 'fallback'; preset: PackagePreset }
  | { status: 'loading' | 'unavailable' };

const isPositive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function usablePreset(
  presets: Record<string, PackagePreset>,
  key: string | null,
): PackagePreset | null {
  const preset = key ? presets[key] : undefined;
  return preset &&
    isPositive(preset.length) &&
    isPositive(preset.width) &&
    isPositive(preset.height) &&
    isPositive(preset.weight)
    ? preset
    : null;
}

/** Resolves the box the label will use, with the same fallback rule as the server. */
export function resolvePreparingBox(
  presetId: string | null,
  presets: Record<string, PackagePreset> | undefined,
): PreparingBox {
  if (!presets) return { status: 'loading' };
  const own = usablePreset(presets, presetId);
  if (own) return { status: 'preset', preset: own };
  const fallback = usablePreset(presets, FALLBACK_PACKAGE_PRESET);
  return fallback
    ? { status: 'fallback', preset: fallback }
    : { status: 'unavailable' };
}
