import i18n from '@/shared/i18n';
import { formatCentsWithLocale } from './format-cents-with-locale';

/** Maps supported i18n languages to BCP 47 tags for `Intl.NumberFormat`. */
const supportedNumberLocales: Record<string, string> = {
  en: 'en-US',
  es: 'es-MX',
};

/** Formats integer cents as MXN in the active i18n locale. */
export const formatCents = (cents: number): string => {
  const locale = supportedNumberLocales[i18n.language] ?? i18n.language;
  return formatCentsWithLocale(cents, locale);
};
