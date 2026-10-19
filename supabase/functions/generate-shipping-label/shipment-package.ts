/**
 * Generic content labels printed on the carrier label. They describe the item
 * truthfully for carrier claims without advertising brand or model.
 */
const CATEGORY_CONTENT: Record<string, string> = {
  GPU: 'Tarjeta de video',
  CPU: 'Procesador',
  Motherboard: 'Tarjeta madre',
  RAM: 'Memoria RAM',
};

const GENERIC_CONTENT = 'Componente de computadora';

export function declaredContentForCategories(categories: string[]): string {
  const labels = [
    ...new Set(categories.map((category) => CATEGORY_CONTENT[category] ?? GENERIC_CONTENT)),
  ];
  return labels.length > 0 ? labels.join(', ') : GENERIC_CONTENT;
}
