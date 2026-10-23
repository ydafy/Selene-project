import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { resolvePublicIdentity } from '../publicIdentity';

const LABEL = 'Usuario eliminado';

describe('resolvePublicIdentity', () => {
  test('keeps username, avatar and profile link for an active account', () => {
    expect(
      resolvePublicIdentity(
        { username: 'maria', avatar_url: 'https://x/a.png', deleted_at: null },
        LABEL,
      ),
    ).toEqual({
      isDeleted: false,
      displayName: 'maria',
      avatarUrl: 'https://x/a.png',
      canOpenProfile: true,
    });
  });

  test('shows the label, no avatar and no link when deleted_at is set', () => {
    expect(
      resolvePublicIdentity(
        {
          username: 'deleted_0123456789ab',
          avatar_url: 'https://x/a.png',
          deleted_at: '2026-10-22T10:00:00Z',
        },
        LABEL,
      ),
    ).toEqual({
      isDeleted: true,
      displayName: LABEL,
      avatarUrl: null,
      canOpenProfile: false,
    });
  });

  test('treats the closure username as closed when deleted_at is not loaded', () => {
    const result = resolvePublicIdentity(
      { username: 'deleted_0123456789ab', avatar_url: null },
      LABEL,
    );
    expect(result.isDeleted).toBe(true);
    expect(result.displayName).toBe(LABEL);
    expect(result.canOpenProfile).toBe(false);
  });

  test('an active account whose chosen username has the closure shape stays active when deleted_at is loaded', () => {
    expect(
      resolvePublicIdentity(
        { username: 'deleted_0123456789ab', avatar_url: null, deleted_at: null },
        LABEL,
      ),
    ).toEqual({
      isDeleted: false,
      displayName: 'deleted_0123456789ab',
      avatarUrl: null,
      canOpenProfile: true,
    });
  });

  test('does not treat look-alike usernames as closed', () => {
    for (const username of [
      'deleted_0123456789a',
      'deleted_0123456789abc',
      'deleted_0123456789AB',
      'deleted_0123456789zz',
      'xdeleted_0123456789ab',
      'deleted_user',
    ]) {
      expect(resolvePublicIdentity({ username }, LABEL).isDeleted).toBe(false);
    }
  });

  test('a missing profile keeps the caller fallback: no name, no link', () => {
    expect(resolvePublicIdentity(null, LABEL)).toEqual({
      isDeleted: false,
      displayName: null,
      avatarUrl: null,
      canOpenProfile: false,
    });
  });

  test('an active profile without username keeps a null name but stays linkable', () => {
    expect(resolvePublicIdentity({ username: null }, LABEL)).toEqual({
      isDeleted: false,
      displayName: null,
      avatarUrl: null,
      canOpenProfile: true,
    });
  });
});

describe('deleted-user copy', () => {
  const load = (locale: string, file: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../../i18n/locales/${locale}/${file}.json`, import.meta.url),
        'utf8',
      ),
    );

  test('has the label and the profile state in es and en', () => {
    expect(load('es', 'common').deletedUser).toBe('Usuario eliminado');
    expect(load('en', 'common').deletedUser).toBe('Deleted user');
    for (const locale of ['es', 'en']) {
      const deleted = load(locale, 'profile').public.deleted;
      expect(deleted.title.length).toBeGreaterThan(0);
      expect(deleted.body.length).toBeGreaterThan(0);
    }
  });
});
