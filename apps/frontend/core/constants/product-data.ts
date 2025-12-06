export const PRODUCT_CONDITIONS = [
  'Nuevo',
  'Usado - Como Nuevo',
  'Usado - Buen Estado',
  'Usado - Aceptable',
];

export const PRICE_LIMITS: Record<string, number> = {
  GPU: 60000, // Tarjetas muy caras
  CPU: 25000, // Threadrippers pueden ser caros
  Motherboard: 20000,
  RAM: 10000, // Kits grandes
  Storage: 15000, // SSDs de 8TB
  Other: 50000, // Default
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

// --- MOTHERBOARD (Tarjetas Madre) ---

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
  'AM4',
  'AM5',
  'LGA 1700',
  'LGA 1200',
  'LGA 1151',
  'TR4',
  'Other',
];

// --- RAM (Memoria) ---

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

// NUEVO: Velocidades estándar para evitar texto libre
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
  'Other',
];

// --- STORAGE (Almacenamiento) ---

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

// --- MAPA DE FILTROS POR CATEGORÍA ---
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
    { id: 'speed_mhz', label: 'Velocidad', options: RAM_SPEEDS }, // Agregado aquí
    { id: 'brand', label: 'Marca', options: RAM_BRANDS },
  ],
  Storage: [
    { id: 'type', label: 'Tipo', options: STORAGE_TYPE },
    { id: 'capacity_gb', label: 'Capacidad', options: STORAGE_CAPACITY },
  ],
};
