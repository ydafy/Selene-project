import i18n from '@/shared/i18n';
import { formatCurrencyWithLocale } from './format-currency-with-locale';

/**
 * Mapa de códigos de idioma soportados a etiquetas BCP 47 reconocidas
 * por `Intl.NumberFormat`. Fallback al código original si no está mapeado.
 */
const supportedNumberLocales: Record<string, string> = {
  en: 'en-US',
  es: 'es-MX',
};

/**
 * Formatea un número como moneda (MXN) usando el locale activo de i18n.
 * Acepta string o number porque Postgres numeric llega a veces como string a JS.
 */
export const formatCurrency = (
  amount: number | string | null | undefined,
): string => {
  const locale = supportedNumberLocales[i18n.language] ?? i18n.language;
  return formatCurrencyWithLocale(amount, locale);
};
