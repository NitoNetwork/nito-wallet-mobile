import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const RGBA_BRAND_ASSETS = [
  ['icon', '../assets/icon.png', 1024],
  ['adaptive icon', '../assets/adaptive-icon.png', 1024],
  ['splash icon', '../assets/splash-icon.png', 1024],
  ['in-app logo', '../assets/nito-logo.png', 1024],
  ['favicon', '../assets/favicon.png', 64],
  ['Android mdpi splash', '../assets/android-splash/drawable-mdpi.png', 288],
  ['Android hdpi splash', '../assets/android-splash/drawable-hdpi.png', 432],
  ['Android xhdpi splash', '../assets/android-splash/drawable-xhdpi.png', 576],
  ['Android xxhdpi splash', '../assets/android-splash/drawable-xxhdpi.png', 864],
  ['Android xxxhdpi splash', '../assets/android-splash/drawable-xxxhdpi.png', 1152],
] as const;

describe('Nito brand assets', () => {
  it.each(RGBA_BRAND_ASSETS)('keeps the %s as a square RGBA PNG', (
    _name,
    relativePath,
    expectedSize,
  ) => {
    const png = readFileSync(new URL(relativePath, import.meta.url));
    expect(png.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    expect(png.readUInt32BE(16)).toBe(expectedSize);
    expect(png.readUInt32BE(20)).toBe(expectedSize);
    expect(png.readUInt8(25)).toBe(6);
  });

  it('uses a white adaptive background and never adds a black box behind the in-app logo', () => {
    const expoConfig = readFileSync(new URL('../app.config.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./ui/styles.ts', import.meta.url), 'utf8');
    const logoStyle = styles.slice(styles.indexOf('  logo: {'), styles.indexOf('  brandText: {'));

    expect(expoConfig).toContain('foregroundImage: "./assets/adaptive-icon.png"');
    expect(expoConfig).toContain('backgroundColor: "#ffffff"');
    expect(expoConfig).toContain('favicon: "./assets/favicon.png"');
    expect(logoStyle).not.toContain('backgroundColor');
  });
});
