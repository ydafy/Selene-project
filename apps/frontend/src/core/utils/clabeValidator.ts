// Catálogo simplificado de bancos principales en México (ABM)
const BANK_CODES: Record<string, string> = {
  '002': 'BANAMEX',
  '012': 'BBVA BANCOMER',
  '014': 'SANTANDER',
  '021': 'HSBC',
  '044': 'SCOTIABANK',
  '058': 'BANREGIO',
  '072': 'BANORTE',
  '127': 'AZTECA',
  '137': 'BANCOPPEL',
  '143': 'CIBANCO',
  '156': 'SABADELL',
  '036': 'INBURSA',
  '062': 'AFIRME',
  '126': 'ACCENDO',
  '138': 'ABC CAPITAL',
  '166': 'BANSEFI',
  '659': 'OPCIONES EMPRESARIALES DEL NORESTE',
  '901': 'STP (SISTEMA DE TRANSFERENCIAS Y PAGOS)',
  '902': 'INDEVAL',
  '670': 'LIBERTAD',
};

// Factores de peso para el algoritmo de módulo 10
const WEIGHTS = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];

export const validateClabe = (clabe: string) => {
  // 1. Limpieza y longitud
  const cleanClabe = clabe.replace(/\D/g, '');
  if (cleanClabe.length !== 18) {
    return { isValid: false, bankName: null, error: 'Debe tener 18 dígitos' };
  }

  // 2. Identificación del Banco (Primeros 3 dígitos)
  const bankCode = cleanClabe.substring(0, 3);
  const bankName = BANK_CODES[bankCode] || 'OTRO BANCO';

  // 3. Cálculo del Dígito Verificador (Algoritmo Oficial)
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const digit = parseInt(cleanClabe[i], 10);
    const weight = WEIGHTS[i];
    const product = (digit * weight) % 10;
    sum += product;
  }

  const calculatedDigit = (10 - (sum % 10)) % 10;
  const actualDigit = parseInt(cleanClabe[17], 10);

  if (calculatedDigit !== actualDigit) {
    return {
      isValid: false,
      bankName,
      error: 'La CLABE es incorrecta (Dígito verificador inválido)',
    };
  }

  return { isValid: true, bankName, error: null };
};
