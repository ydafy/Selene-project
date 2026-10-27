import { describe, expect, it } from 'bun:test';

import appConfig from '../../app.json';

/**
 * DESIGN.md: "Theme: dark only." With `automatic`, a phone in light mode
 * renders the system UI (keyboard, date pickers, alerts) light (BL21).
 */
describe('app config theme', () => {
  it('locks the system UI to dark', () => {
    expect(appConfig.expo.userInterfaceStyle).toBe('dark');
  });
});
