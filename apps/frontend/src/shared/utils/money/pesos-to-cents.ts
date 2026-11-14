const INVALID_PESOS_AMOUNT = 'INVALID_PESOS_AMOUNT';

const parsePesos = (value: number | string): number => {
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  // Plain decimal notation only: no empty string, exponent, or "Infinity".
  if (!/^-?\d+(\.\d+)?$/.test(trimmed) && !/^-?\.\d+$/.test(trimmed)) {
    return Number.NaN;
  }
  return Number(trimmed);
};

/**
 * Converts a pesos amount from an external boundary (a form input, an Envia
 * quote) to integer cents. Rounds half away from zero on the decimal value, so
 * float noise such as 19.99 * 100 = 1998.999... still gives 1999.
 *
 * Throws `INVALID_PESOS_AMOUNT` for non-finite, negative, or unsafe values.
 */
export const pesosToCents = (value: number | string): number => {
  const pesos = parsePesos(value);
  if (!Number.isFinite(pesos) || pesos < 0) {
    throw new Error(INVALID_PESOS_AMOUNT);
  }

  // Shift the decimal point in the string form to avoid binary float error.
  const text = String(pesos);
  const shifted = text.includes('e') ? pesos * 100 : Number(`${text}e2`);
  const cents = Math.round(shifted) + 0;

  if (!Number.isSafeInteger(cents)) {
    throw new Error(INVALID_PESOS_AMOUNT);
  }
  return cents;
};

/**
 * Like `pesosToCents`, but returns null instead of throwing. For live form
 * values that may be half-typed (an empty input, "12abc").
 */
export const tryPesosToCents = (value: number | string): number | null => {
  try {
    return pesosToCents(value);
  } catch {
    return null;
  }
};

/**
 * Formats integer cents as the plain pesos string the sell form edits:
 * whole pesos without decimals (100000 -> "1000"), otherwise two decimals
 * (15050 -> "150.50"). `pesosToCents` reads it back to the same cents.
 *
 * Throws `INVALID_CENTS_AMOUNT` for negative, fractional, or unsafe cents.
 */
export const centsToPesosInput = (cents: number): string => {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error('INVALID_CENTS_AMOUNT');
  }
  const pesos = Math.trunc(cents / 100);
  const remainder = cents % 100;
  return remainder === 0
    ? String(pesos)
    : `${pesos}.${String(remainder).padStart(2, '0')}`;
};
