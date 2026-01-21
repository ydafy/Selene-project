/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Normaliza un objeto o valor para comparación profunda.
 * 1. Ordena las llaves alfabéticamente.
 * 2. Convierte valores primitivos a string para evitar conflictos de tipos (10 vs "10").
 * 3. Elimina nulos/undefined para evitar falsos positivos.
 */
export const normalize = (obj: any): any => {
  if (!obj) return {};

  // Si es un array, normalizamos cada elemento
  if (Array.isArray(obj)) {
    return obj.map(normalize);
  }

  // Si es primitivo, lo devolvemos como string
  if (typeof obj !== 'object') {
    return String(obj);
  }

  // Si es objeto, ordenamos y limpiamos
  return Object.keys(obj)
    .sort()
    .reduce((acc: any, key) => {
      const val = obj[key];
      // Ignoramos valores vacíos
      if (val !== null && val !== undefined && val !== '') {
        acc[key] = normalize(val);
      }
      return acc;
    }, {});
};
