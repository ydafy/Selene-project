import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import esCommon from './locales/es/common.json';
import esAuth from './locales/es/auth.json';

// ✨ 1. DEFINE LOS NAMESPACES (Nombres de nuestros archivos JSON)
export const namespaces = ['common', 'auth'];
// Definimos un tipo para asegurar que solo usamos namespaces que existen
export type Namespace = (typeof namespaces)[number];

// ✨ 2. DEFINE LOS IDIOMAS
export const supportedLngs = ['en', 'es'];

// ✨ 3. DETECTA EL IDIOMA DEL DISPOSITIVO DE FORMA SEGURA
const deviceLanguage = Localization.getLocales()[0]?.languageCode ?? 'en';
const languageToUse = supportedLngs.includes(deviceLanguage)
  ? deviceLanguage
  : 'en';

// ✨ 4. CARGA LOS RECURSOS USANDO require()
// Esto es robusto en el entorno de React Native
const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
  },
  es: {
    common: esCommon,
    auth: esAuth,
  },
};

// ✨ 5. CONFIGURA E INICIALIZA I18NEXT
i18n.use(initReactI18next).init({
  // Hacemos un "cast" de los recursos para que TypeScript esté contento
  resources: resources as typeof i18n.options.resources,

  lng: languageToUse,
  fallbackLng: 'en',
  supportedLngs,

  ns: namespaces,
  defaultNS: 'common',

  interpolation: {
    escapeValue: false, // React ya se encarga de esto
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
