import { describe, expect, it } from 'vitest';

import { createStyles, RAW_STYLES } from './styles';
import {
  collectStyleColors,
  isThemeName,
  LIGHT_COLOR_MAP,
  mapStyleColors,
  themeColor,
  DEFAULT_THEME,
  QR_COLORS,
  STATUS_BAR_BACKGROUND,
} from './theme';
import tabsSource from './tabs.tsx?raw';
import screensSource from './screens.tsx?raw';
import componentsSource from './components.tsx?raw';
import appSource from '../../App.tsx?raw';

describe('theme', () => {
  it('defaults to dark', () => {
    expect(DEFAULT_THEME).toBe('dark');
  });

  it('accepts only the two supported theme names', () => {
    expect(isThemeName('dark')).toBe(true);
    expect(isThemeName('light')).toBe(true);
    expect(isThemeName('system')).toBe(false);
    expect(isThemeName(null)).toBe(false);
    expect(isThemeName('')).toBe(false);
  });

  it('returns the untouched stylesheet for the dark theme', () => {
    // Structural guarantee: dark is the very same object, so the rendering that
    // shipped before the theme system cannot drift by a single value.
    expect(createStyles('dark')).toBe(RAW_STYLES);
    expect(mapStyleColors(RAW_STYLES, 'dark')).toBe(RAW_STYLES);
    expect(themeColor('dark', '#f6f8ff')).toBe('#f6f8ff');
  });

  it('memoizes the light stylesheet instead of rebuilding it per render', () => {
    expect(createStyles('light')).toBe(createStyles('light'));
  });

  it('maps every colour the stylesheet uses', () => {
    const unmapped = collectStyleColors(RAW_STYLES).filter(
      (color) => LIGHT_COLOR_MAP[color] === undefined,
    );

    expect(unmapped).toEqual([]);
  });

  it('never leaves a dark colour in the light stylesheet', () => {
    const light = createStyles('light');
    const darkOnly = collectStyleColors(RAW_STYLES).filter(
      (color) => LIGHT_COLOR_MAP[color] !== color,
    );
    const remaining = collectStyleColors(light).filter((color) => darkOnly.includes(color));

    expect(remaining).toEqual([]);
  });

  const SHADOW_INTENSITY = ['shadowOpacity', 'shadowRadius', 'elevation'];

  it('preserves every non-colour, non-shadow declaration exactly', () => {
    const light = createStyles('light') as Record<string, Record<string, unknown>>;
    const raw = RAW_STYLES as unknown as Record<string, Record<string, unknown>>;

    for (const [styleName, declarations] of Object.entries(raw)) {
      for (const [property, value] of Object.entries(declarations)) {
        const isColor = typeof value === 'string'
          && (value.startsWith('#') || value.startsWith('rgba('));
        if (isColor || SHADOW_INTENSITY.includes(property)) continue;
        expect(light[styleName]?.[property]).toEqual(value);
      }
    }
  });

  it('softens shadow geometry on paper instead of only recolouring it', () => {
    const light = createStyles('light') as Record<string, Record<string, unknown>>;
    const raw = RAW_STYLES as unknown as Record<string, Record<string, unknown>>;
    const caps: Record<string, number> = {
      shadowOpacity: 0.08,
      shadowRadius: 10,
      elevation: 3,
    };

    for (const [styleName, declarations] of Object.entries(raw)) {
      for (const [property, value] of Object.entries(declarations)) {
        if (!SHADOW_INTENSITY.includes(property) || typeof value !== 'number') continue;
        const lightValue = light[styleName]?.[property];
        expect(lightValue).toBeLessThanOrEqual(caps[property]!);
        // A shadowless style must stay shadowless rather than gain one.
        if (value === 0) expect(lightValue).toBe(0);
        expect(lightValue).toBeLessThanOrEqual(value);
      }
    }
  });

  it('keeps the same style keys in both themes', () => {
    expect(Object.keys(createStyles('light'))).toEqual(Object.keys(RAW_STYLES));
  });
});

describe('inline theme colours', () => {
  // Colours passed as props rather than through the stylesheet escape the
  // coverage check above. Scanning the sources keeps them under the same rule:
  // an unmapped literal would silently stay dark on paper.
  const sources = [tabsSource, screensSource, componentsSource].join('\n');

  it('maps every colour passed through themeColor()', () => {
    const literals = [...sources.matchAll(/themeColor\('(#[0-9a-fA-F]{3,8})'\)/g)]
      .map((match) => match[1]!);

    expect(literals.length).toBeGreaterThan(0);
    expect(literals.filter((color) => LIGHT_COLOR_MAP[color] === undefined)).toEqual([]);
  });

  it('leaves no raw colour literal outside themeColor() or an explicit pair', () => {
    const raw = [...sources.matchAll(/(?<!themeColor\(')(?<![0-9a-fA-F])#[0-9a-fA-F]{6}\b/g)]
      .map((match) => match[0]);
    const allowed = new Set(Object.values(QR_COLORS).flatMap(
      ({ foreground, background }) => [foreground, background],
    ));

    expect(raw.filter((color) => !allowed.has(color))).toEqual([]);
  });

  it('keeps the QR code dark-on-light in both themes so it stays scannable', () => {
    expect(QR_COLORS.dark.foreground).toBe('#071326');
    expect(QR_COLORS.dark.background).toBe('#f8fbff');
    expect(QR_COLORS.light.foreground).not.toBe(QR_COLORS.light.background);
  });
});

describe('native chrome', () => {
  it('drives the status bar from the wallet theme, not the system appearance', () => {
    // app.config.js pins androidStatusBar.backgroundColor to the dark surface and
    // iOS follows the system. Without this the paper theme would draw white
    // status text on cream when the phone itself is in dark mode.
    expect(STATUS_BAR_BACKGROUND.dark).toBe('#020611');
    expect(STATUS_BAR_BACKGROUND.light).toBe(LIGHT_COLOR_MAP['#020611']);
    expect(appSource).toContain("barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}");
    expect(appSource).toContain('backgroundColor={STATUS_BAR_BACKGROUND[theme]}');
  });
});
