/**
 * Selene's public domain, the single source for code that needs it.
 *
 * Placeholder until the real domain is registered: `.example` is reserved
 * (RFC 2606) and never resolves. When the domain exists, change it here and
 * follow docs/go-live.md, "Domain", for the settings that live outside code.
 */
export const SELENE_DOMAIN = 'selene.example';

export const SELENE_WEB_URL = `https://${SELENE_DOMAIN}`;

export const SELENE_SUPPORT_EMAIL = `soporte@${SELENE_DOMAIN}`;

/** Public pages served by the admin-web without a session (Google Play and the privacy link). */
export const ACCOUNT_DELETION_PATH = '/eliminar-cuenta';
export const PRIVACY_PATH = '/privacidad';

export const ACCOUNT_DELETION_URL = `${SELENE_WEB_URL}${ACCOUNT_DELETION_PATH}`;
export const PRIVACY_URL = `${SELENE_WEB_URL}${PRIVACY_PATH}`;
