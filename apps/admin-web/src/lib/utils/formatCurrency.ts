/**
 * Formatea un número como moneda (MXN por defecto).
 * @param amount - El precio en número.
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0, // En México solemos omitir centavos si son 00, pero es gusto personal
    maximumFractionDigits: 2,
  }).format(amount);
};
