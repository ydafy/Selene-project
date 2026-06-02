/**
 * SPEI bank codes for BBVA Net Cash dispersion files.
 * Maps bank name variations to their 3-digit Banxico/SPEI codes.
 *
 * Source: docs/bbva-dispersion-format.md
 */
export const SPEI_BANK_CODES: Map<string, string> = new Map([
  // BBVA México
  ['BBVA', '012'],
  ['BBVA México', '012'],
  ['BBVA Bancomer', '012'],

  // Banorte / IXE
  ['Banorte', '072'],
  ['Banorte / IXE', '072'],
  ['IXE', '072'],

  // Santander México
  ['Santander México', '014'],
  ['Santander', '014'],

  // Banco Azteca
  ['Banco Azteca', '019'],
  ['Azteca', '019'],

  // HSBC México
  ['HSBC México', '021'],
  ['HSBC', '021'],

  // Banco del Bajío
  ['Banco del Bajío', '030'],
  ['Bajío', '030'],

  // Inbursa
  ['Inbursa', '036'],
  ['Banco Inbursa', '059'],

  // Mifel
  ['Mifel', '042'],
  ['Banco Mifel', '042'],

  // Scotiabank
  ['Scotiabank', '044'],

  // STP
  ['STP', '600'],
  ['Sistema de Transferencias y Pagos', '600'],

  // Banamex
  ['Banamex', '001'],
  ['Banco Nacional de México', '001'],

  // Bancomext
  ['Bancomext', '006'],
  ['Banco Nacional de Comercio Exterior', '006'],

  // American Express
  ['American Express', '058'],

  // The Royal Bank of Scotland
  ['The Royal Bank of Scotland', '102'],
  ['Royal Bank of Scotland', '102'],

  // American Express Bank
  ['American Express Bank', '103'],

  // Banco Multiva
  ['Banco Multiva', '112'],
  ['Multiva', '112'],

  // Bancoppel
  ['Bancoppel', '134'],
]);

/**
 * Returns the 3-digit SPEI code for a given bank name.
 * Lookup is case-insensitive.
 *
 * @throws Error if the bank name is not found in SPEI_BANK_CODES
 */
export function getBankCode(bankName: string): string {
  if (!bankName) {
    throw new Error(`Banco no soportado: ${bankName}`);
  }

  const normalized = bankName.trim();
  // Try exact match first
  const exact = SPEI_BANK_CODES.get(normalized);
  if (exact) return exact;

  // Try case-insensitive match
  for (const [key, code] of SPEI_BANK_CODES.entries()) {
    if (key.toLowerCase() === normalized.toLowerCase()) {
      return code;
    }
  }

  throw new Error(`Banco no soportado: ${bankName}`);
}
