export interface CLABEResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a Mexican CLABE (Clave Bancaria Estandarizada) using the official
 * checksum algorithm defined by Banxico.
 *
 * Algorithm:
 * - CLABE is 18 digits
 * - Positions 1-17: account digits
 * - Position 18: check digit
 * - Weighting sequence: [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7]
 * - For each digit position i (1-17): multiply digit[i-1] by weight[i-1], take modulo 10
 * - Sum all modulo results, take modulo 10
 * - Check digit = (10 - (sum modulo 10)) modulo 10
 * - If sum modulo 10 is 0, check digit is 0
 */
export function validateCLABE(clabe: string): CLABEResult {
  if (!clabe || clabe.length !== 18) {
    return { valid: false, error: 'CLABE debe tener 18 dígitos' };
  }

  if (!/^\d+$/.test(clabe)) {
    return { valid: false, error: 'CLABE debe contener solo dígitos' };
  }

  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
  let sum = 0;

  for (let i = 0; i < 17; i++) {
    const digit = parseInt(clabe[i], 10);
    const product = (digit * weights[i]) % 10;
    sum += product;
  }

  const sumMod10 = sum % 10;
  const expectedCheckDigit = sumMod10 === 0 ? 0 : (10 - sumMod10) % 10;
  const actualCheckDigit = parseInt(clabe[17], 10);

  if (actualCheckDigit !== expectedCheckDigit) {
    return { valid: false, error: 'Dígito verificador inválido' };
  }

  return { valid: true };
}
