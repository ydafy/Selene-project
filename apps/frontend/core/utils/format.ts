import { formatDistanceToNow, format } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import i18n from '../i18n'; // Importamos nuestra config de i18n para saber el idioma actual

/**
 * Formatea un número como moneda (MXN por defecto).
 * @param amount - El precio en número.
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0, // En México solemos omitir centavos si son 00, pero es gusto personal
    maximumFractionDigits: 2,
  }).format(amount);
};

/**
 * Formatea una fecha relativa (ej. "hace 2 horas", "2 hours ago").
 * @param dateString - Fecha en formato ISO string o Date.
 */
export const formatRelativeTime = (dateString: string | Date): string => {
  const date =
    typeof dateString === 'string' ? new Date(dateString) : dateString;

  // Detectamos el idioma actual de la app
  const currentLocale = i18n.language === 'es' ? es : enUS;

  return formatDistanceToNow(date, {
    addSuffix: true, // Añade "hace..." o "...ago"
    locale: currentLocale,
  });
};

/**
 * Formatea una fecha absoluta (ej. "12 oct 2025").
 * @param dateString - Fecha en formato ISO string o Date.
 */
export const formatDate = (dateString: string | Date): string => {
  const date =
    typeof dateString === 'string' ? new Date(dateString) : dateString;
  const currentLocale = i18n.language === 'es' ? es : enUS;

  // Formato: día mes año (ej. 12 oct 2025)
  return format(date, 'd MMM yyyy', { locale: currentLocale });
};
