import { expect, test } from 'bun:test';
import { generateBBVAFile } from './generateBBVAFile';

const validRow = {
  bankName: 'BBVA México',
  clabe: '002180012345678919',
  amount: 15500.50,
  beneficiaryName: 'María Muñoz García',
  reference: 'REF001',
};

// Valid Banorte CLABE computed with official checksum
const validBanorteRow = {
  bankName: 'Banorte / IXE',
  clabe: '072180012345678910',
  amount: 1000,
  beneficiaryName: 'José Pérez',
  reference: 'REF002',
};

test('valid single row produces correct format', () => {
  const result = generateBBVAFile([validRow]);
  const expectedLine = '012,002180012345678919,15500.50,MARIA MUNOZ GARCIA,REF001';
  expect(result.content.trim()).toBe(expectedLine);
  expect(result.rowCount).toBe(1);
});

test('valid multiple rows, each on its own line', () => {
  const result = generateBBVAFile([validRow, validBanorteRow]);
  const lines = result.content.trim().split('\n');
  expect(lines.length).toBe(2);
  expect(lines[0]).toBe('012,002180012345678919,15500.50,MARIA MUNOZ GARCIA,REF001');
  expect(lines[1]).toBe('072,072180012345678910,1000,JOSE PEREZ,REF002');
});

test('valid row with amount having 2 decimals', () => {
  const row = {
    bankName: 'BBVA México',
    clabe: '002180012345678919',
    amount: 15500.50,
    beneficiaryName: 'Test User',
    reference: 'REF003',
  };
  const result = generateBBVAFile([row]);
  expect(result.content).toContain(',15500.50,');
});

test('invalid CLABE throws with row details', () => {
  const row = {
    bankName: 'BBVA México',
    clabe: '002115070000000005',
    amount: 100,
    beneficiaryName: 'Test',
    reference: 'REF004',
  };
  expect(() => generateBBVAFile([row])).toThrow('REF004');
  expect(() => generateBBVAFile([row])).toThrow('CLABE');
});

test('unknown bank throws with bank name', () => {
  const row = {
    bankName: 'Banco Inexistente',
    clabe: '002180012345678919',
    amount: 100,
    beneficiaryName: 'Test',
    reference: 'REF005',
  };
  expect(() => generateBBVAFile([row])).toThrow('Banco Inexistente');
});

test('checksum equals sum of all amounts in cents', () => {
  const row1 = { ...validRow, reference: 'REF006' };
  const row2 = { ...validBanorteRow, amount: 500.50, reference: 'REF007' };
  const result = generateBBVAFile([row1, row2]);
  const expectedCents = Math.round(15500.50 * 100) + Math.round(500.50 * 100);
  expect(result.checksum).toBe(expectedCents);
});

test('leading zeros preserved in bank codes and CLABEs', () => {
  const row = {
    bankName: 'BBVA México',
    clabe: '002180012345678919',
    amount: 100,
    beneficiaryName: 'Test',
    reference: 'REF008',
  };
  const result = generateBBVAFile([row]);
  expect(result.content).toContain('012');
  expect(result.content).toContain('002180012345678919');
});

test('duplicate references throws', () => {
  const row1 = { ...validRow, reference: 'DUPE' };
  const row2 = { ...validBanorteRow, reference: 'DUPE' };
  expect(() => generateBBVAFile([row1, row2])).toThrow('duplicada');
});

test('file content starts with bank code (no BOM, no header)', () => {
  const result = generateBBVAFile([validRow]);
  expect(result.content.startsWith('012')).toBe(true);
  // BOM check: UTF-8 BOM is EF BB BF. If present, string starts with \uFEFF
  expect(result.content.charCodeAt(0)).not.toBe(0xfeff);
  // Should not have any header line before the data
  const firstLine = result.content.split('\n')[0];
  expect(firstLine).toBe('012,002180012345678919,15500.50,MARIA MUNOZ GARCIA,REF001');
});

test('amount formatting: 1000 → "1000", 15500.5 → "15500.50", 100 → "100"', () => {
  const r1 = { ...validRow, amount: 1000, reference: 'A1' };
  const r2 = { ...validRow, amount: 15500.5, reference: 'A2' };
  const r3 = { ...validRow, amount: 100, reference: 'A3' };

  const res1 = generateBBVAFile([r1]);
  const res2 = generateBBVAFile([r2]);
  const res3 = generateBBVAFile([r3]);

  expect(res1.content).toContain(',1000,');
  expect(res2.content).toContain(',15500.50,');
  expect(res3.content).toContain(',100,');
});

test('filename follows dispersion_YYYYMMDD_HHmmss.txt pattern', () => {
  const result = generateBBVAFile([validRow]);
  expect(result.filename).toMatch(/^dispersion_\d{8}_\d{6}\.txt$/);
});
