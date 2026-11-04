// --- DATOS GLOBALES ---

export const PRODUCT_CONDITIONS = [
  'Nuevo',
  'Usado - Como Nuevo',
  'Usado - Buen Estado',
  'Usado - Aceptable',
];

export const PRICE_LIMITS: Record<string, number> = {
  GPU: 60000,
  CPU: 25000,
  Motherboard: 20000,
  RAM: 10000,
  Storage: 15000,
  Other: 50000,
};

export const DEFAULT_MAX_PRICE = 60000;

// --- GPU (Tarjetas Gráficas) ---

export const GPU_CHIPSETS = ['NVIDIA', 'AMD', 'Intel', 'Other'];

export const GPU_BRANDS = [
  'ASUS',
  'MSI',
  'Gigabyte',
  'EVGA',
  'Zotac',
  'PNY',
  'Sapphire',
  'PowerColor',
  'XFX',
  'ASRock',
  'Intel',
  'NVIDIA (Founders)',
  'Other',
];

export const GPU_MEMORY = [
  '3 GB',
  '6 GB',
  '8 GB',
  '10 GB',
  '12 GB',
  '16 GB',
  '20 GB',
  '24 GB',
  '32 GB',
  '48 GB',
  'Other',
];
// 1. DEFINIMOS LISTAS ESPECÍFICAS PRIMERO
export const GPU_MODELS_NVIDIA = [
  // --- Blackwell (Serie 50) ---
  'RTX 5090',
  'RTX 5080 SUPER',
  'RTX 5080',
  'RTX 5070 Ti SUPER',
  'RTX 5070 Ti',
  'RTX 5070 SUPER',
  'RTX 5070',
  'RTX 5060 Ti',
  'RTX 5060',
  'RTX 5050',

  // --- Ada Lovelace (Serie 40) ---
  'RTX 4090',
  'RTX 4080 SUPER',
  'RTX 4080',
  'RTX 4070 Ti SUPER',
  'RTX 4070 Ti',
  'RTX 4070 SUPER',
  'RTX 4070',
  'RTX 4060 Ti',
  'RTX 4060',

  // --- Ampere (Serie 30) ---
  'RTX 3090 Ti',
  'RTX 3090',
  'RTX 3080 Ti',
  'RTX 3080',
  'RTX 3070 Ti',
  'RTX 3070',
  'RTX 3060 Ti',
  'RTX 3060',
  'RTX 3050',

  // --- Turing (Serie 20 / 16) ---
  'RTX 2080 Ti',
  'RTX 2080 SUPER',
  'RTX 2080',
  'RTX 2070 SUPER',
  'RTX 2070',
  'RTX 2060 SUPER',
  'RTX 2060',
  'GTX 1660 Ti',
  'GTX 1660 SUPER',
  'GTX 1660',
  'GTX 1650 SUPER',
  'GTX 1650',
  'GTX 1630',

  // --- Pascal (Serie 10) ---
  'GTX 1080 Ti',
  'GTX 1080',
  'GTX 1070 Ti',
  'GTX 1070',
  'GTX 1060',
  'GTX 1050 Ti',
  'GTX 1050',

  // --- Titan ---
  'TITAN RTX',
  'TITAN V',
  'TITAN Xp',
  'TITAN X (Pascal)',

  'NVIDIA Other',
];

export const GPU_MODELS_AMD = [
  // --- Serie 9000 (RDNA 4 - 2025/2026) ---
  'RX 9070 XT',
  'RX 9070',
  'RX 9070 GRE',
  'RX 9060 XT',
  'RX 9060',

  // --- Serie 7000 (RDNA 3) ---
  'RX 7900 XTX',
  'RX 7900 XT',
  'RX 7900 GRE',
  'RX 7800 XT',
  'RX 7700 XT',
  'RX 7700',
  'RX 7650 GRE',
  'RX 7600 XT',
  'RX 7600',
  'RX 7400',

  // --- Serie 6000 (RDNA 2) ---
  'RX 6950 XT',
  'RX 6900 XT',
  'RX 6800 XT',
  'RX 6800',
  'RX 6750 XT',
  'RX 6750 GRE',
  'RX 6700 XT',
  'RX 6700',
  'RX 6650 XT',
  'RX 6600 XT',
  'RX 6600',
  'RX 6600 LE',
  'RX 6500 XT',
  'RX 6400',

  // --- Serie 5000 (RDNA 1) ---
  'RX 5700 XT',
  'RX 5700',
  'RX 5600 XT',
  'RX 5500 XT',

  // --- Serie Vega & Radeon VII ---
  'Radeon VII',
  'RX Vega 64',
  'RX Vega 56',

  // --- Serie 500 & 400 (Polaris - Los clásicos) ---
  'RX 590',
  'RX 580',
  'RX 570',
  'RX 560 XT',
  'RX 560',
  'RX 550',
  'RX 480',
  'RX 470',
  'RX 460',

  'AMD Other',
];
export const GPU_MODELS_INTEL = [
  // Serie B (2024, Battlemage)
  'Arc B770',
  'Arc B580',
  'Arc B570',
  'Arc B550',
  // Serie A (2022, Alchemist)
  'Arc A770',
  'Arc A750',
  'Arc A580',
  'Arc A380',
  'Arc A310',
  'Intel Other',
];
// LISTA MASIVA (Para el futuro formulario de venta)
export const GPU_MODELS = [
  ...GPU_MODELS_NVIDIA,
  ...GPU_MODELS_AMD,
  ...GPU_MODELS_INTEL,
  'Other / Model Not Listed',
];

// --- CPU (Procesadores) ---

export const CPU_BRANDS = ['Intel', 'AMD', 'Other'];

export const CPU_FAMILIES = [
  'Core i9',
  'Core i7',
  'Core i5',
  'Core i3',
  'Ryzen 9',
  'Ryzen 7',
  'Ryzen 5',
  'Ryzen 3',
  'Threadripper',
  'Xeon',
  'Other',
];

export const CPU_CORES = [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 64];

export const CPU_MODELS_INTEL = [
  // --- CORE ULTRA SERIES 2 (Socket 1851 - Arrow Lake) ---
  'Core Ultra 9 285K',
  'Core Ultra 9 285',
  'Core Ultra 7 265K',
  'Core Ultra 7 265KF',
  'Core Ultra 7 265',
  'Core Ultra 7 265F',
  'Core Ultra 5 245K',
  'Core Ultra 5 245KF',
  'Core Ultra 5 245',
  'Core Ultra 5 235',
  'Core Ultra 5 225',
  'Core Ultra 5 225F',
  'Core Ultra 3 205',

  // --- 14va GENERACIÓN (Socket 1700 - Raptor Lake Refresh) ---
  'Core i9-14900KS',
  'Core i9-14900K',
  'Core i9-14900KF',
  'Core i9-14900',
  'Core i9-14900F',
  'Core i7-14700K',
  'Core i7-14700KF',
  'Core i7-14700',
  'Core i7-14700F',
  'Core i5-14600K',
  'Core i5-14600KF',
  'Core i5-14600',
  'Core i5-14500',
  'Core i5-14400',
  'Core i5-14400F',
  'Core i3-14100',
  'Core i3-14100F',
  'Processor 300',

  // --- 13va GENERACIÓN (Socket 1700 - Raptor Lake) ---
  'Core i9-13900KS',
  'Core i9-13900K',
  'Core i9-13900KF',
  'Core i9-13900',
  'Core i9-13900F',
  'Core i7-13700K',
  'Core i7-13700KF',
  'Core i7-13700',
  'Core i7-13700F',
  'Core i5-13600K',
  'Core i5-13600KF',
  'Core i5-13600',
  'Core i5-13500',
  'Core i5-13400',
  'Core i5-13400F',
  'Core i3-13100',
  'Core i3-13100F',

  // --- 12va GENERACIÓN (Socket 1700 - Alder Lake) ---
  'Core i9-12900KS',
  'Core i9-12900K',
  'Core i9-12900KF',
  'Core i9-12900',
  'Core i7-12700K',
  'Core i7-12700KF',
  'Core i7-12700',
  'Core i7-12700F',
  'Core i5-12600K',
  'Core i5-12600KF',
  'Core i5-12600',
  'Core i5-12500',
  'Core i5-12400',
  'Core i5-12400F',
  'Core i3-12300',
  'Core i3-12100',
  'Core i3-12100F',

  // --- 11va GENERACIÓN (Socket 1200 - Rocket Lake) ---
  'Core i9-11900K',
  'Core i9-11900KF',
  'Core i9-11900',
  'Core i7-11700K',
  'Core i7-11700KF',
  'Core i7-11700',
  'Core i5-11600K',
  'Core i5-11600KF',
  'Core i5-11600',
  'Core i5-11400',
  'Core i5-11400F',

  // --- 10ma GENERACIÓN (Socket 1200 - Comet Lake) ---
  'Core i9-10900K',
  'Core i9-10900KF',
  'Core i9-10900',
  'Core i7-10700K',
  'Core i7-10700KF',
  'Core i7-10700',
  'Core i5-10600K',
  'Core i5-10600KF',
  'Core i5-10600',
  'Core i5-10400',
  'Core i5-10400F',
  'Core i3-10320',
  'Core i3-10300',
  'Core i3-10100',
  'Core i3-10100F',

  // --- 9na GENERACIÓN (Socket 1151 - Coffee Lake R) ---
  'Core i9-9900KS',
  'Core i9-9900K',
  'Core i9-9900KF',
  'Core i9-9900',
  'Core i7-9700K',
  'Core i7-9700KF',
  'Core i7-9700',
  'Core i5-9600K',
  'Core i5-9600KF',
  'Core i5-9400',
  'Core i5-9400F',
  'Core i3-9350K',
  'Core i3-9100',
  'Core i3-9100F',

  // --- HIGH-END DESKTOP (Socket 2066 - Core X) ---
  'Core i9-10980XE',
  'Core i9-10940X',
  'Core i9-10920X',
  'Core i9-10900X',
  'Core i9-9980XE',
  'Core i9-9960X',
  'Core i9-9940X',
  'Core i9-9920X',

  'Intel Other',
];
export const CPU_MODELS_AMD = [
  // --- SOCKET AM5: SERIE 9000 (Zen 5) ---
  'Ryzen 9 9950X3D',
  'Ryzen 9 9950X',
  'Ryzen 9 9900X3D',
  'Ryzen 9 9900X',
  'Ryzen 7 9850X3D',
  'Ryzen 7 9800X3D',
  'Ryzen 7 9700X',
  'Ryzen 7 9700F',
  'Ryzen 5 9600X',
  'Ryzen 5 9500F',

  // --- SOCKET AM5: RYZEN AI (Zen 5/5c) ---
  'Ryzen AI 7 450G',
  'Ryzen AI 5 440G',
  'Ryzen AI 5 435G',

  // --- SOCKET AM5: SERIE 7000 (Zen 4) ---
  'Ryzen 9 7950X3D',
  'Ryzen 9 7950X',
  'Ryzen 9 7900X3D',
  'Ryzen 9 7900X',
  'Ryzen 9 7900',
  'Ryzen 7 7800X3D',
  'Ryzen 7 7700X',
  'Ryzen 7 7700',
  'Ryzen 5 7600X3D',
  'Ryzen 5 7600X',
  'Ryzen 5 7600',
  'Ryzen 5 7500X3D',
  'Ryzen 5 7500F',
  'Ryzen 5 7400F',
  'Ryzen 5 7400',

  // --- SOCKET AM5: SERIE 8000 (Zen 4 Phoenix) ---
  'Ryzen 7 8700G',
  'Ryzen 7 8700F',
  'Ryzen 5 8600G',
  'Ryzen 5 8400F',
  'Ryzen 5 8500G',
  'Ryzen 3 8300G',

  // --- SOCKET AM4: SERIE 5000 (Zen 3) ---
  'Ryzen 9 5950X',
  'Ryzen 9 5900XT',
  'Ryzen 9 5900X',
  'Ryzen 9 5900',
  'Ryzen 7 5800XT',
  'Ryzen 7 5800X3D',
  'Ryzen 7 5800X',
  'Ryzen 7 5800G',
  'Ryzen 7 5800',
  'Ryzen 7 5700X3D',
  'Ryzen 7 5700X',
  'Ryzen 7 5700G',
  'Ryzen 7 5700',
  'Ryzen 7 5705G',
  'Ryzen 5 5600X3D',
  'Ryzen 5 5600XT',
  'Ryzen 5 5600X',
  'Ryzen 5 5600GT',
  'Ryzen 5 5600G',
  'Ryzen 5 5600',
  'Ryzen 5 5600F',
  'Ryzen 5 5605G',
  'Ryzen 5 5500X3D',
  'Ryzen 5 5500GT',
  'Ryzen 5 5500G',
  'Ryzen 5 5500',
  'Ryzen 3 5305G',
  'Ryzen 3 5300G',

  // --- SOCKET AM4: SERIE 4000 (Zen 2) ---
  'Ryzen 7 4700G',
  'Ryzen 5 4600G',
  'Ryzen 5 4500',
  'Ryzen 3 4300G',
  'Ryzen 3 4100',

  // --- SOCKET AM4: SERIE 3000 (Zen 2 / Zen+) ---
  'Ryzen 9 3950X',
  'Ryzen 9 3900XT',
  'Ryzen 9 3900X',
  'Ryzen 9 3900',
  'Ryzen 7 3800XT',
  'Ryzen 7 3800X',
  'Ryzen 7 3700X',
  'Ryzen 5 3600XT',
  'Ryzen 5 3600X',
  'Ryzen 5 3600',
  'Ryzen 5 3500X',
  'Ryzen 5 3500',
  'Ryzen 3 3300X',
  'Ryzen 3 3100',
  'Ryzen 5 3400G',
  'Ryzen 3 3200G',

  // --- SOCKET AM4: LEGADO Y ENTRADA ---
  'Ryzen 5 1600 AF',
  'Athlon Gold 3150G',
  'Athlon 3000G',

  'Other',
];

// LISTA MASIVA (Para el futuro formulario de venta)
export const CPU_MODELS = [
  ...CPU_MODELS_INTEL,
  ...CPU_MODELS_AMD,
  'Other / Model Not Listed',
];

// --- MOTHERBOARD ---

export const MOBO_BRANDS = [
  'ASUS',
  'MSI',
  'Gigabyte',
  'ASRock',
  'EVGA',
  'NZXT',
  'Biostar',
  'Other',
];

export const MOBO_FORM_FACTOR = [
  'ATX',
  'E-ATX',
  'Micro-ATX',
  'Mini-ITX',
  'Other',
];

export const MOBO_SOCKETS = [
  'AM5',
  'AM4',
  'LGA 1851',
  'LGA 1700',
  'LGA 1200',
  'Other',
];
export const MOBO_MEMORY_SLOTS = [2, 4, 8, 'Other'];
export const MOBO_CHIPSETS_AM4 = [
  'B550',
  'X570',
  'B450',
  'A520',
  'X470',
  'Other',
];
export const MOBO_CHIPSETS_AM5 = [
  'X870E',
  'X870',
  'B850',
  'B650E',
  'B650',
  'A620',
  'Other',
];
export const MOBO_CHIPSETS_LGA1700 = [
  'Z790',
  'Z690',
  'B760',
  'B660',
  'H610',
  'Other',
];
export const MOBO_CHIPSETS_LGA1200 = [
  'Z590',
  'B560',
  'H510',
  'Z490',
  'B460',
  'Other',
];
// Fallback para otros sockets
export const MOBO_CHIPSETS_GENERIC = [
  'Intel Z-Series',
  'Intel B-Series',
  'AMD X-Series',
  'AMD B-Series',
  'Other',
];

// --- RAM ---
export const RAM_BRANDS = [
  'Corsair',
  'G.Skill',
  'Kingston',
  'ADATA (XPG)',
  'TeamGroup',
  'Crucial',
  'Samsung',
  'Patriot',
  'Lexar',
  'Gigabyte',
  'Other',
];

export const RAM_TYPE = ['DDR5', 'DDR4', 'DDR3', 'Other'];

export const RAM_CAPACITY = [
  '8 GB',
  '16 GB',
  '32 GB',
  '64 GB',
  '128 GB',
  'Other',
];

export const RAM_SPEEDS = [
  '2133 MHz',
  '2400 MHz',
  '2666 MHz',
  '3000 MHz',
  '3200 MHz',
  '3600 MHz',
  '4000 MHz',
  '4800 MHz',
  '5200 MHz',
  '5600 MHz',
  '6000 MHz',
  '6400 MHz',
  '6800 MHz',
  '7200 MHz+',
  'Other',
];

// --- STORAGE ---

export const STORAGE_TYPE = ['SSD NVMe (M.2)', 'SSD SATA', 'HDD', 'Other'];

export const STORAGE_CAPACITY = [
  '250 GB',
  '500 GB',
  '1 TB',
  '2 TB',
  '4 TB',
  '8 TB+',
  'Other',
];

export const PRODUCT_USAGE_OPTIONS = [
  'Nuevo (Sin abrir)',
  'Solo abierto (Sin uso)',
  'Menos de 1 mes',
  '1 - 6 meses',
  '6 meses - 1 año',
  '1 - 2 años',
  'Más de 2 años',
  'Desconocido',
];
