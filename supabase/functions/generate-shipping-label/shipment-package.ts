/**
 * Generic content labels printed on the carrier label. They describe the item
 * truthfully for carrier claims without advertising brand or model.
 */
const CATEGORY_CONTENT: Record<string, string> = {
  GPU: 'Tarjeta de video',
  CPU: 'Procesador',
  Motherboard: 'Tarjeta madre',
  RAM: 'Memoria RAM',
};

const GENERIC_CONTENT = 'Componente de computadora';

/** Largest standard box; used only when an item's own preset is unusable. */
export const FALLBACK_PACKAGE_PRESET = 'mobo_1';

export interface ShipmentPackage {
  length: number;
  width: number;
  height: number;
  weight: number;
  /** Item preset keys that were replaced by the fallback preset. */
  fallbackPresetKeys: string[];
}

type PackageDimensions = Omit<ShipmentPackage, 'fallbackPresetKeys'>;

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function readPreset(presets: unknown, key: string | null): PackageDimensions | null {
  if (!key || !presets || typeof presets !== 'object') return null;
  const preset = (presets as Record<string, unknown>)[key];
  if (!preset || typeof preset !== 'object') return null;
  const { length, width, height, weight } = preset as Record<string, unknown>;
  return isPositive(length) && isPositive(width) && isPositive(height) && isPositive(weight)
    ? { length, width, height, weight }
    : null;
}

/**
 * Stacks item presets into one box. Returns null when an item has no usable
 * preset and the fallback preset is unusable too: no label without real dimensions.
 */
export function resolveShipmentPackage(
  presetKeys: (string | null)[],
  presets: unknown,
): ShipmentPackage | null {
  if (presetKeys.length === 0) return null;
  const result: ShipmentPackage = {
    length: 0,
    width: 0,
    height: 0,
    weight: 0,
    fallbackPresetKeys: [],
  };

  for (const key of presetKeys) {
    let dimensions = readPreset(presets, key);
    if (!dimensions) {
      dimensions = readPreset(presets, FALLBACK_PACKAGE_PRESET);
      if (!dimensions) return null;
      result.fallbackPresetKeys.push(String(key));
    }
    result.weight += dimensions.weight;
    result.length = Math.max(result.length, dimensions.length);
    result.width = Math.max(result.width, dimensions.width);
    result.height += dimensions.height;
  }
  return result;
}

export function declaredContentForCategories(categories: string[]): string {
  const labels = [
    ...new Set(categories.map((category) => CATEGORY_CONTENT[category] ?? GENERIC_CONTENT)),
  ];
  return labels.length > 0 ? labels.join(', ') : GENERIC_CONTENT;
}
