/**
 * @file core/utils/version.ts
 * @description Compara dos versiones semánticas (ej. 1.10.0 vs 1.2.0).
 * @returns true si la versión actual es menor que la requerida.
 */
export const isVersionLower = (current: string, required: string): boolean => {
  const v1 = current.split('.').map(Number);
  const v2 = required.split('.').map(Number);

  // Comparamos Major, Minor y Patch
  for (let i = 0; i < 3; i++) {
    const part1 = v1[i] || 0;
    const part2 = v2[i] || 0;

    if (part1 < part2) return true;
    if (part1 > part2) return false;
  }

  return false; // Son iguales
};
