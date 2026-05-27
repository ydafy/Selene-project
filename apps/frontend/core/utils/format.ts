import { formatDistanceToNow, format, isValid } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import i18n from '../i18n';

// Helper interno para obtener el locale actual
const getLocale = () => (i18n.language === 'es' ? es : enUS);

/**
 * Formatea un número como moneda (MXN).
 * Acepta string o number porque Postgres numeric llega a veces como string a JS.
 */
export const formatCurrency = (
  amount: number | string | null | undefined,
): string => {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (value === null || value === undefined || isNaN(value)) return '$0.00';

  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

/**
 * Formato inteligente:
 * - Menos de 1 min: "Justo ahora"
 * - Menos de 24h: "hace X horas"
 * - Más de 24h: "12 oct 2025"
 */
export const formatSmartTime = (
  dateString: string | Date | null | undefined,
): string => {
  if (!dateString) return '---';
  const date =
    typeof dateString === 'string' ? new Date(dateString) : dateString;
  if (!isValid(date)) return '---';

  const diffInSeconds = Math.floor(
    (new Date().getTime() - date.getTime()) / 1000,
  );

  if (diffInSeconds < 60) return i18n.t('common:time.justNow');

  if (diffInSeconds < 86400) {
    return formatDistanceToNow(date, { addSuffix: true, locale: getLocale() });
  }

  return format(date, 'd MMM yyyy', { locale: getLocale() });
};

/**
 * Formatea una fecha relativa (ej. "hace 2 horas").
 */
export const formatRelativeTime = (
  dateString: string | Date | null | undefined,
): string => {
  if (!dateString) return '---';
  const date =
    typeof dateString === 'string' ? new Date(dateString) : dateString;

  if (!isValid(date)) return '---';

  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: getLocale(),
  });
};

/**
 * Formatea una fecha absoluta (ej. "12 oct 2025").
 */
export const formatDate = (
  dateString: string | Date | null | undefined,
): string => {
  if (!dateString) return '---';
  const date =
    typeof dateString === 'string' ? new Date(dateString) : dateString;

  if (!isValid(date)) return '---';

  return format(date, 'd MMM yyyy', { locale: getLocale() });
};
