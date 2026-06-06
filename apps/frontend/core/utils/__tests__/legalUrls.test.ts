import { expect, test, describe } from 'bun:test';
import {
  TERMS_URL_DEFAULT,
  PRIVACY_URL_DEFAULT,
  resolveLegalUrls,
} from '../legalUrls';

/**
 * Covers CONF-012/CONF-013: Terms & Privacy URLs resolved from env with
 * placeholder fallbacks.
 */
describe('resolveLegalUrls', () => {
  test('uses placeholder defaults when env vars are empty', () => {
    expect(resolveLegalUrls({})).toEqual({
      terms: TERMS_URL_DEFAULT,
      privacy: PRIVACY_URL_DEFAULT,
    });
  });

  test('prefers env-provided terms URL', () => {
    expect(
      resolveLegalUrls({
        EXPO_PUBLIC_TERMS_URL: 'https://custom.example/terms',
      }).terms,
    ).toBe('https://custom.example/terms');
  });

  test('prefers env-provided privacy URL', () => {
    expect(
      resolveLegalUrls({
        EXPO_PUBLIC_PRIVACY_URL: 'https://custom.example/privacy',
      }).privacy,
    ).toBe('https://custom.example/privacy');
  });

  test('default Terms URL points to selene.mx', () => {
    expect(TERMS_URL_DEFAULT).toBe('https://selene.mx/terminos');
  });

  test('default Privacy URL points to selene.mx', () => {
    expect(PRIVACY_URL_DEFAULT).toBe('https://selene.mx/privacidad');
  });
});
