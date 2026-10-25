import { describe, expect, test } from 'bun:test';
import { buildSupportMailto, resolveSupportEmail } from '../supportEmail';

describe('resolveSupportEmail', () => {
  test('returns the trimmed address when it is configured', () => {
    expect(
      resolveSupportEmail({ EXPO_PUBLIC_SUPPORT_EMAIL: '  soporte@selene.mx ' }),
    ).toBe('soporte@selene.mx');
  });

  test('returns null when the variable is missing or blank', () => {
    expect(resolveSupportEmail({})).toBeNull();
    expect(resolveSupportEmail({ EXPO_PUBLIC_SUPPORT_EMAIL: '   ' })).toBeNull();
  });

  test('returns null for a value that is not an email address', () => {
    expect(resolveSupportEmail({ EXPO_PUBLIC_SUPPORT_EMAIL: 'soporte' })).toBeNull();
    expect(
      resolveSupportEmail({ EXPO_PUBLIC_SUPPORT_EMAIL: 'soporte@selene' }),
    ).toBeNull();
    expect(
      resolveSupportEmail({ EXPO_PUBLIC_SUPPORT_EMAIL: 'a b@selene.mx' }),
    ).toBeNull();
  });
});

describe('buildSupportMailto', () => {
  test('builds a mailto link with the encoded subject', () => {
    expect(buildSupportMailto('soporte@selene.mx', 'Soporte Selene')).toBe(
      'mailto:soporte@selene.mx?subject=Soporte%20Selene',
    );
  });

  test('encodes characters that would break the query string', () => {
    expect(buildSupportMailto('soporte@selene.mx', 'Duda & reporte?')).toBe(
      'mailto:soporte@selene.mx?subject=Duda%20%26%20reporte%3F',
    );
  });
});
