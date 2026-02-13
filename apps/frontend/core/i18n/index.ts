import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import esCommon from './locales/es/common.json';
import esAuth from './locales/es/auth.json';
import enProduct from './locales/en/product.json';
import esProduct from './locales/es/product.json';
import enCart from './locales/en/cart.json';
import esCart from './locales/es/cart.json';
import enSearch from './locales/en/search.json';
import esSearch from './locales/es/search.json';
import enProfile from './locales/en/profile.json';
import esProfile from './locales/es/profile.json';
import enSell from './locales/en/sell.json';
import esSell from './locales/es/sell.json';
import esVerify from './locales/es/verify.json';
import enVerify from './locales/en/verify.json';
import esAdmin from './locales/es/admin.json';
import enAdmin from './locales/en/admin.json';
import esAddress from './locales/es/address.json';
import enAddress from './locales/en/address.json';
import esCheckout from './locales/es/checkout.json';
import enCheckout from './locales/en/checkout.json';
import esWallet from './locales/es/wallet.json';
import enWallet from './locales/en/wallet.json';

// ✨ 1. DEFINE LOS NAMESPACES (Nombres de nuestros archivos JSON)
export const namespaces = [
  'common',
  'auth',
  'product',
  'cart',
  'search',
  'profile',
  'verify',
  'sell',
  'admin',
  'address',
  'checkout',
  'wallet',
];
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
    product: enProduct,
    cart: enCart,
    search: enSearch,
    profile: enProfile,
    sell: enSell,
    verify: enVerify,
    admin: enAdmin,
    address: enAddress,
    checkout: enCheckout,
    wallet: enWallet,
  },
  es: {
    common: esCommon,
    auth: esAuth,
    product: esProduct,
    cart: esCart,
    search: esSearch,
    profile: esProfile,
    sell: esSell,
    verify: esVerify,
    admin: esAdmin,
    address: esAddress,
    checkout: esCheckout,
    wallet: esWallet,
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
