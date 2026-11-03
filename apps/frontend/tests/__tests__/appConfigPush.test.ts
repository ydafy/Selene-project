import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from '../../app.json';
import appConfig, { resolveGoogleServicesFile } from '../../app.config';

const frontendRoot = join(import.meta.dir, '..', '..');
const configContext: ConfigContext = {
  // JSON imports widen literal unions such as `orientation` to string.
  config: appJson.expo as ExpoConfig,
  projectRoot: frontendRoot,
  staticConfigPath: join(frontendRoot, 'app.json'),
  packageJsonPath: join(frontendRoot, 'package.json'),
};

type PluginEntry = string | [string, Record<string, unknown>];

const notificationsPlugin = (plugins: PluginEntry[] | undefined) =>
  plugins?.find(
    (plugin): plugin is [string, Record<string, unknown>] =>
      Array.isArray(plugin) && plugin[0] === 'expo-notifications',
  );

/**
 * Push needs Firebase on Android (L57). The repository is public, so
 * google-services.json stays out of it: EAS provides it as the file
 * variable GOOGLE_SERVICES_JSON, and local builds read a gitignored file.
 */
describe('app config for push', () => {
  it('reads google-services.json from the EAS file variable when set', () => {
    expect(
      resolveGoogleServicesFile({ GOOGLE_SERVICES_JSON: '/eas/tmp/gs.json' }),
    ).toBe('/eas/tmp/gs.json');
  });

  it('falls back to the gitignored local file', () => {
    expect(resolveGoogleServicesFile({})).toBe('./google-services.json');
    expect(resolveGoogleServicesFile({ GOOGLE_SERVICES_JSON: '' })).toBe(
      './google-services.json',
    );
  });

  it('extends app.json and sets the Firebase file for Android', () => {
    const previous = process.env.GOOGLE_SERVICES_JSON;
    process.env.GOOGLE_SERVICES_JSON = '/eas/tmp/gs.json';
    try {
      const config = appConfig(configContext);
      expect(config.name).toBe(appJson.expo.name);
      expect(config.android?.package).toBe('com.selene.marketplace');
      expect(config.android?.adaptiveIcon).toEqual(
        appJson.expo.android.adaptiveIcon,
      );
      expect(config.android?.googleServicesFile).toBe('/eas/tmp/gs.json');
      expect(config.plugins).toEqual(appJson.expo.plugins as PluginEntry[]);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_SERVICES_JSON;
      else process.env.GOOGLE_SERVICES_JSON = previous;
    }
  });

  it('keeps every app.json value and only adds the Firebase file', () => {
    const previous = process.env.GOOGLE_SERVICES_JSON;
    delete process.env.GOOGLE_SERVICES_JSON;
    try {
      const { android, ...rest } = appConfig(configContext);
      const { googleServicesFile, ...androidRest } = android ?? {};
      expect(googleServicesFile).toBe('./google-services.json');
      const resolved: ExpoConfig = { ...rest, android: androidRest };
      expect(resolved).toEqual(appJson.expo as ExpoConfig);
    } finally {
      if (previous !== undefined) process.env.GOOGLE_SERVICES_JSON = previous;
    }
  });

  it('keeps google-services.json out of Git', () => {
    const gitignore = readFileSync(
      join(frontendRoot, '..', '..', '.gitignore'),
      'utf8',
    );
    expect(gitignore).toMatch(/^apps\/frontend\/google-services\.json\s*$/m);
  });

  it('gives Android a 96x96 transparent notification icon', () => {
    const plugin = notificationsPlugin(appJson.expo.plugins as PluginEntry[]);
    expect(plugin?.[1].icon).toBe('./assets/images/notification-icon.png');

    const png = readFileSync(
      join(frontendRoot, 'assets', 'images', 'notification-icon.png'),
    );
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(96);
    expect(png.readUInt32BE(20)).toBe(96);
    // IHDR color type 6 is RGBA: Android draws only the alpha channel.
    expect(png[25]).toBe(6);
  });
});
