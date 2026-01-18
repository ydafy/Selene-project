import {
  GPU_CHIPSETS,
  GPU_BRANDS,
  GPU_MEMORY,
  GPU_MODELS_NVIDIA,
  GPU_MODELS_AMD,
  GPU_MODELS_INTEL,
  CPU_BRANDS,
  CPU_FAMILIES,
  CPU_CORES,
  CPU_MODELS_INTEL,
  CPU_MODELS_AMD,
  MOBO_BRANDS,
  MOBO_SOCKETS,
  MOBO_FORM_FACTOR,
  RAM_BRANDS,
  MOBO_CHIPSETS_AM4,
  MOBO_CHIPSETS_AM5,
  MOBO_CHIPSETS_LGA1700,
  MOBO_CHIPSETS_LGA1200,
  MOBO_CHIPSETS_GENERIC,
  MOBO_MEMORY_SLOTS,
  RAM_TYPE,
  RAM_CAPACITY,
  RAM_SPEEDS,
  STORAGE_TYPE,
  STORAGE_CAPACITY,
} from '../constants/product-data';

export type SellFieldConfig = {
  name: string;
  label: string;
  placeholder: string;
  type: 'select';
  options?: string[] | number[];
  searchable?: boolean;
  dependsOn?: string; // Nombre del campo padre
  optionsMap?: Record<string, string[]>; // Mapa Padre -> Hijos
};

export const SELL_FORM_CONFIG: Record<string, SellFieldConfig[]> = {
  GPU: [
    {
      name: 'chipset',
      label: 'sell:fields.chipsetLabel',
      placeholder: 'sell:fields.chipsetPlaceholder',
      type: 'select',
      options: GPU_CHIPSETS,
    },
    {
      name: 'brand',
      label: 'sell:fields.brandLabel',
      placeholder: 'sell:fields.brandPlaceholder',
      type: 'select',
      options: GPU_BRANDS,
    },
    {
      name: 'model',
      label: 'sell:fields.modelLabel',
      placeholder: 'sell:fields.modelPlaceholder',
      type: 'select',
      searchable: true,
      dependsOn: 'chipset', // <--- ESTO ACTIVA LA CASCADA
      optionsMap: {
        NVIDIA: GPU_MODELS_NVIDIA,
        AMD: GPU_MODELS_AMD,
        Intel: GPU_MODELS_INTEL,
        Other: [],
      },
    },
    {
      name: 'memory',
      label: 'sell:fields.vramLabel',
      placeholder: 'sell:fields.vramPlaceholder',
      type: 'select',
      options: GPU_MEMORY,
    },
  ],
  CPU: [
    {
      name: 'brand',
      label: 'sell:fields.brandLabel',
      placeholder: 'sell:fields.brandPlaceholder',
      type: 'select',
      options: CPU_BRANDS,
    },
    {
      name: 'family',
      label: 'sell:fields.familyLabel',
      placeholder: 'sell:fields.familyPlaceholder',
      type: 'select',
      options: CPU_FAMILIES,
    },
    {
      name: 'model',
      label: 'sell:fields.modelLabel',
      placeholder: 'sell:fields.modelPlaceholder',
      type: 'select',
      searchable: true,
      dependsOn: 'brand', // <--- CASCADA PARA CPU
      optionsMap: {
        Intel: CPU_MODELS_INTEL,
        AMD: CPU_MODELS_AMD,
        Other: [],
      },
    },
    {
      name: 'cores',
      label: 'sell:fields.coresLabel',
      placeholder: 'sell:fields.coresPlaceholder',
      type: 'select',
      options: CPU_CORES,
    },
  ],
  Motherboard: [
    {
      name: 'brand',
      label: 'sell:fields.brandLabel',
      placeholder: 'sell:fields.brandPlaceholder',
      type: 'select',
      options: MOBO_BRANDS,
    },
    {
      name: 'socket',
      label: 'sell:fields.socketLabel',
      placeholder: 'sell:fields.socketPlaceholder',
      type: 'select',
      options: MOBO_SOCKETS,
    },
    {
      name: 'form_factor',
      label: 'sell:fields.formFactorLabel',
      placeholder: 'sell:fields.formFactorPlaceholder',
      type: 'select',
      options: MOBO_FORM_FACTOR,
    },
    {
      name: 'chipset',
      label: 'sell:fields.chipsetLabel',
      placeholder: 'sell:fields.chipsetPlaceholder',
      type: 'select',
      dependsOn: 'socket', // <--- CASCADA INTELIGENTE
      optionsMap: {
        AM4: MOBO_CHIPSETS_AM4,
        AM5: MOBO_CHIPSETS_AM5,
        'LGA 1700': MOBO_CHIPSETS_LGA1700,
        'LGA 1200': MOBO_CHIPSETS_LGA1200,
        Other: MOBO_CHIPSETS_GENERIC,
      },
      // Si el socket no está en el mapa, usará options (vacío o genérico)
      options: MOBO_CHIPSETS_GENERIC,
    },
    {
      name: 'memory_type',
      label: 'sell:fields.memoryTypeLabel',
      placeholder: 'sell:fields.memoryTypePlaceholder',
      type: 'select',
      options: RAM_TYPE, // DDR4, DDR5...
    },
    {
      name: 'memory_slots',
      label: 'sell:fields.memorySlotsLabel',
      placeholder: 'sell:fields.memorySlotsPlaceholder',
      type: 'select',
      options: MOBO_MEMORY_SLOTS,
    },
  ],
  RAM: [
    {
      name: 'brand',
      label: 'sell:fields.brandLabel',
      placeholder: 'sell:fields.brandPlaceholder',
      type: 'select',
      options: RAM_BRANDS,
    },
    {
      name: 'type',
      label: 'sell:fields.typeLabel',
      placeholder: 'sell:fields.typePlaceholder',
      type: 'select',
      options: RAM_TYPE,
    },
    {
      name: 'capacity',
      label: 'sell:fields.capacityLabel',
      placeholder: 'sell:fields.capacityPlaceholder',
      type: 'select',
      options: RAM_CAPACITY,
    },
    {
      name: 'speed',
      label: 'sell:fields.speedLabel',
      placeholder: 'sell:fields.speedPlaceholder',
      type: 'select',
      options: RAM_SPEEDS,
    },
  ],
  Storage: [
    {
      name: 'type',
      label: 'sell:fields.typeLabel',
      placeholder: 'sell:fields.typePlaceholder',
      type: 'select',
      options: STORAGE_TYPE,
    },
    {
      name: 'capacity',
      label: 'sell:fields.capacityLabel',
      placeholder: 'sell:fields.capacityPlaceholder',
      type: 'select',
      options: STORAGE_CAPACITY,
    },
  ],
  Other: [],
};
