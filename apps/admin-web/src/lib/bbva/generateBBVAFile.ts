import { validateCLABE } from './validateCLABE';
import { getBankCode } from './bankCodes';
import { sanitizeBBVAName } from './sanitizeBBVAName';

export interface BBVARow {
  bankName: string;
  clabe: string;
  amount: number;
  beneficiaryName: string;
  reference: string;
}

export interface BBVAFileResult {
  content: string; // UTF-8 without BOM
  filename: string; // dispersion_YYYYMMDD_HHmmss.txt
  checksum: number; // sum of all amounts (in cents to avoid floating point)
  rowCount: number;
}

function formatAmount(amount: number): string {
  const fixed = amount.toFixed(2);
  if (fixed.endsWith('.00')) {
    return fixed.slice(0, -3);
  }
  return fixed;
}

export function generateBBVAFile(rows: BBVARow[]): BBVAFileResult {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Se requiere al menos una fila');
  }

  // Check duplicate references
  const refs = new Set<string>();
  for (const row of rows) {
    if (refs.has(row.reference)) {
      throw new Error(`Referencia duplicada: ${row.reference}`);
    }
    refs.add(row.reference);
  }

  let checksum = 0;
  const lines: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Validate CLABE
    const clabeResult = validateCLABE(row.clabe);
    if (!clabeResult.valid) {
      throw new Error(
        `Fila ${i + 1} (${row.reference}): CLABE inválida - ${clabeResult.error}`,
      );
    }

    // Validate bank code
    let bankCode: string;
    try {
      bankCode = getBankCode(row.bankName);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Banco inválido';
      throw new Error(`Fila ${i + 1} (${row.reference}): ${message}`);
    }

    // Sanitize name
    const sanitizedName = sanitizeBBVAName(row.beneficiaryName);

    // Format amount
    const amountStr = formatAmount(row.amount);

    // Build line
    lines.push(`${bankCode},${row.clabe},${amountStr},${sanitizedName},${row.reference}`);

    // Add to checksum (in cents to avoid floating point)
    checksum += Math.round(row.amount * 100);
  }

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const filename = `dispersion_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;

  const content = lines.join('\n') + '\n';

  return {
    content,
    filename,
    checksum,
    rowCount: rows.length,
  };
}
