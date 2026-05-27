/**
 * @file core/utils/form-helpers.ts
 * @description Utilidades compartidas para la gestión de formularios dinámicos.
 */

/**
 * Detecta si un valor seleccionado requiere una especificación manual ("Other").
 * Se usa tanto en esquemas de validación como en componentes de UI.
 */
export const checkIfOther = (value: any): boolean => {
  if (!value) return false;
  const val = String(value);
  return val === 'Other' || val.endsWith('Other') || val.includes('Not Listed');
};
