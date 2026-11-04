import { ProductCategory } from '@selene/types';

export interface TriageQuestion {
  id: string;
  labelKey: string;
}

export const MIN_DESCRIPTION_LENGTH = 20;

/**
 *  Usamos un tipo que permite las categorías oficiales
 * y añade obligatoriamente la llave 'DEFAULT' para fallbacks.
 */
type ChecklistMap = {
  [key in ProductCategory]: TriageQuestion[];
} & {
  DEFAULT: TriageQuestion[]; // Cambiamos 'Other' por 'DEFAULT' para evitar confusiones
};

export const DISPUTE_CHECKLISTS: ChecklistMap = {
  GPU: [
    { id: 'gpu_power', labelKey: 'triage.gpu.power' },
    { id: 'gpu_port', labelKey: 'triage.gpu.port' },
    { id: 'gpu_drivers', labelKey: 'triage.gpu.drivers' },
    { id: 'gpu_psu', labelKey: 'triage.gpu.psu' },
  ],
  CPU: [
    { id: 'cpu_socket', labelKey: 'triage.cpu.socket' },
    { id: 'cpu_pins', labelKey: 'triage.cpu.pins' },
    { id: 'cpu_bios', labelKey: 'triage.cpu.bios' },
    { id: 'cpu_cooler', labelKey: 'triage.cpu.cooler' },
  ],
  RAM: [
    { id: 'ram_click', labelKey: 'triage.ram.click' },
    { id: 'ram_clean', labelKey: 'triage.ram.clean' },
    { id: 'ram_single', labelKey: 'triage.ram.single' },
    { id: 'ram_xmp', labelKey: 'triage.ram.xmp' },
  ],
  Motherboard: [
    { id: 'mobo_standoffs', labelKey: 'triage.mobo.standoffs' },
    { id: 'mobo_cpu_power', labelKey: 'triage.mobo.cpu_power' },
    { id: 'mobo_pins', labelKey: 'triage.mobo.pins' },
    { id: 'mobo_flashback', labelKey: 'triage.mobo.flashback' },
  ],
  // Esta es la opción de respaldo si la categoría falla o es ambigua
  DEFAULT: [
    { id: 'other_manual', labelKey: 'triage.other.manual' },
    { id: 'other_compat', labelKey: 'triage.other.compat' },
    { id: 'other_cables', labelKey: 'triage.other.cables' },
  ],
};

/**
 * Helper para obtener el checklist con fallback seguro
 */
export const getChecklistForCategory = (
  category: ProductCategory | string | null,
): TriageQuestion[] => {
  if (!category) return DISPUTE_CHECKLISTS.DEFAULT;

  // Verificamos si la categoría existe en nuestro mapa de preguntas
  const selected = DISPUTE_CHECKLISTS[category as ProductCategory];

  return selected || DISPUTE_CHECKLISTS.DEFAULT;
};
