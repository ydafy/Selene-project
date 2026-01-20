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

export const DEFAULT_MAX_PRICE = 50000;

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
  '2 GB',
  '4 GB',
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
  'RTX 4090',
  'RTX 4080 Super',
  'RTX 4080',
  'RTX 4070 Ti Super',
  'RTX 4070 Ti',
  'RTX 4070 Super',
  'RTX 4070',
  'RTX 4060 Ti',
  'RTX 4060',
  'RTX 3090 Ti',
  'RTX 3090',
  'RTX 3080 Ti',
  'RTX 3080',
  'RTX 3070 Ti',
  'RTX 3070',
  'RTX 3060 Ti',
  'RTX 3060',
  'RTX 3050',
  'RTX 2080 Ti',
  'RTX 2080 Super',
  'RTX 2080',
  'RTX 2070 Super',
  'RTX 2060',
  'GTX 1660 Super',
  'GTX 1080 Ti',
  'GTX 1080',
  'GTX 1070',
  'GTX 1060',
  'NVIDIA Other',
];

export const GPU_MODELS_AMD = [
  'RX 7900 XTX',
  'RX 7900 XT',
  'RX 7800 XT',
  'RX 7700 XT',
  'RX 7600',
  'RX 6950 XT',
  'RX 6900 XT',
  'RX 6800 XT',
  'RX 6700 XT',
  'RX 6600 XT',
  'RX 6600',
  'RX 5700 XT',
  'RX 5600 XT',
  'RX 580',
  'RX 570',
  'AMD Other',
];
export const GPU_MODELS_INTEL = [
  'Arc A770',
  'Arc A750',
  'Arc A580',
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
  'i9-14900K',
  'i7-14700K',
  'i5-14600K',
  'i9-13900K',
  'i7-13700K',
  'i5-13600K',
  'i9-12900K',
  'i7-12700K',
  'i5-12600K',
  'i5-12400F',
  'Intel Other',
];

export const CPU_MODELS_AMD = [
  'Ryzen 9 7950X3D',
  'Ryzen 7 7800X3D',
  'Ryzen 5 7600X',
  'Ryzen 9 5950X',
  'Ryzen 9 5900X',
  'Ryzen 7 5800X3D',
  'Ryzen 7 5700X',
  'Ryzen 5 5600X',
  'Ryzen 5 5600',
  'AMD Other',
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
  'TR4',
  'LGA 1700',
  'LGA 1200',
  'LGA 1151',
  'LGA 2066',
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
  'B650',
  'X670',
  'X670E',
  'B650E',
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

// --- MAPA DE FILTROS POR CATEGORÍA (UI SEGURA) ---
// Nota: NO incluimos GPU_MODELS ni CPU_MODELS aquí todavía para evitar el crash.
// Esas listas se usarán en el componente FormSelect del módulo de venta.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const FILTERS_BY_CATEGORY: Record<string, any> = {
  GPU: [
    { id: 'chipset', label: 'Chipset', options: GPU_CHIPSETS },
    { id: 'brand', label: 'Marca', options: GPU_BRANDS },
    { id: 'memory_gb', label: 'Memoria VRAM', options: GPU_MEMORY },
  ],
  CPU: [
    { id: 'brand', label: 'Marca', options: CPU_BRANDS },
    { id: 'series', label: 'Familia', options: CPU_FAMILIES },
    { id: 'cores', label: 'Núcleos', options: CPU_CORES },
  ],
  Motherboard: [
    { id: 'brand', label: 'Marca', options: MOBO_BRANDS },
    { id: 'socket', label: 'Socket', options: MOBO_SOCKETS },
    { id: 'form_factor', label: 'Formato', options: MOBO_FORM_FACTOR },
  ],
  RAM: [
    { id: 'type', label: 'Tipo', options: RAM_TYPE },
    { id: 'capacity_gb', label: 'Capacidad Total', options: RAM_CAPACITY },
    { id: 'speed_mhz', label: 'Velocidad', options: RAM_SPEEDS },
    { id: 'brand', label: 'Marca', options: RAM_BRANDS },
  ],
  Storage: [
    { id: 'type', label: 'Tipo', options: STORAGE_TYPE },
    { id: 'capacity_gb', label: 'Capacidad', options: STORAGE_CAPACITY },
  ],
};
