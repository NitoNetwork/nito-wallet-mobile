import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { TYPOGRAPHY } from './typography';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const BACKGROUNDS = [
  '../../assets/backgrounds/nito-auth-horizon.png',
  '../../assets/backgrounds/nito-wallet-horizon.png',
] as const;

const FONTS = [
  ['regular', '../../assets/fonts/SpaceGrotesk-Regular.ttf'],
  ['medium', '../../assets/fonts/SpaceGrotesk-Medium.ttf'],
  ['semibold', '../../assets/fonts/SpaceGrotesk-SemiBold.ttf'],
  ['bold', '../../assets/fonts/SpaceGrotesk-Bold.ttf'],
] as const;

describe('A3 visual foundation', () => {
  it.each(BACKGROUNDS)('keeps %s as the selected portrait PNG', (relativePath) => {
    const png = readFileSync(new URL(relativePath, import.meta.url));

    expect(png.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    expect(png.readUInt32BE(16)).toBe(852);
    expect(png.readUInt32BE(20)).toBe(1846);
  });

  it.each(FONTS)('embeds the Space Grotesk %s face', (weight, relativePath) => {
    const font = readFileSync(new URL(relativePath, import.meta.url));

    expect(font.length).toBeGreaterThan(80_000);
    expect(TYPOGRAPHY[weight]).toMatch(/^SpaceGrotesk-/);
  });

  it('registers all four faces through the native expo-font plugin', () => {
    const expoConfig = readFileSync(new URL('../../app.config.js', import.meta.url), 'utf8');

    expect(expoConfig).toContain('"expo-font"');
    for (const family of Object.values(TYPOGRAPHY)) {
      expect(expoConfig).toContain(`fontFamily: "${family}"`);
    }
  });
});
