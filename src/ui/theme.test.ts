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
import settingsSource from './settings.tsx?raw';
import diceSource from './dice.tsx?raw';
import appSource from '../../App.tsx?raw';

type RgbaColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

const parseColor = (color: string): RgbaColor => {
  const hexChannels = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hexChannels) {
    return {
      red: Number.parseInt(hexChannels[1]!, 16),
      green: Number.parseInt(hexChannels[2]!, 16),
      blue: Number.parseInt(hexChannels[3]!, 16),
      alpha: 1,
    };
  }

  const rgbaChannels = color.match(
    /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/i,
  );
  if (rgbaChannels) {
    return {
      red: Number(rgbaChannels[1]),
      green: Number(rgbaChannels[2]),
      blue: Number(rgbaChannels[3]),
      alpha: Number(rgbaChannels[4]),
    };
  }

  throw new Error(`Unsupported colour: ${color}`);
};

const compositeColor = (foreground: RgbaColor, background: RgbaColor): RgbaColor => {
  const alpha = foreground.alpha + (background.alpha * (1 - foreground.alpha));
  const compositeChannel = (foregroundChannel: number, backgroundChannel: number) => (
    ((foregroundChannel * foreground.alpha)
      + (backgroundChannel * background.alpha * (1 - foreground.alpha))) / alpha
  );
  return {
    red: compositeChannel(foreground.red, background.red),
    green: compositeChannel(foreground.green, background.green),
    blue: compositeChannel(foreground.blue, background.blue),
    alpha,
  };
};

const relativeLuminance = (color: RgbaColor): number => {
  const channels = [color.red, color.green, color.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;
  return (0.2126 * red!) + (0.7152 * green!) + (0.0722 * blue!);
};

const contrastRatio = (foreground: RgbaColor, background: RgbaColor): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

type StyleMap = Record<string, Record<string, unknown>>;
type StyleName = keyof typeof RAW_STYLES & string;

const BASE_SURFACE_STYLE_NAMES = [
  'screen',
  'balanceCard',
  'tabs',
] as const satisfies readonly StyleName[];
type BaseSurfaceStyleName = typeof BASE_SURFACE_STYLE_NAMES[number];

/**
 * Text normally has to clear all three paper surfaces. These entries add the
 * tinted or opaque container that the rendered component actually supplies.
 * The audit composes every translucent container over its permitted bases.
 */
const TEXT_CONTAINER_CONTEXTS: Partial<Record<StyleName, readonly StyleName[]>> = {
  languageCurrent: ['languageSettingsButton'],
  languageChevron: ['languageSettingsButton'],
  languageOptionCode: ['languageOption'],
  languageOptionCodeActive: ['languageOptionActive'],
  languageOptionName: ['languageOption'],
  loadingOverlayTitle: ['loadingOverlay'],
  loadingOverlayText: ['loadingOverlay'],
  title: ['hero'],
  sectionTitle: ['card'],
  refreshButtonText: ['refreshButton'],
  body: ['card'],
  helper: ['card', 'settingsOptionPanel', 'historyRow'],
  label: ['card', 'txBox'],
  buttonText: ['button'],
  buttonTextSecondary: ['buttonSecondary'],
  buttonTextGhost: ['buttonGhost'],
  buttonTextDanger: ['buttonDanger'],
  recipientRemoveText: ['recipientCard'],
  addRecipientText: ['addRecipientButton'],
  scanButtonText: ['scanButton'],
  maxButtonText: ['maxButton'],
  passwordInput: ['passwordField'],
  passwordToggleText: ['passwordToggle'],
  seedVisibilityButtonText: ['seedVisibilityButton'],
  noticeTitle: ['notice'],
  noticeText: ['notice'],
  tabText: ['tabs'],
  tabTextActive: ['tabActive'],
  balance: ['balanceCard'],
  pendingBalance: ['balanceCard'],
  immatureCoinbaseBalance: ['balanceCard'],
  balanceUpdatingText: ['balanceCard'],
  previewAddress: ['preview', 'txBox'],
  emptyTitle: ['empty'],
  historyPageButtonText: ['historyPageButton'],
  historyPageTotal: ['card'],
  historyLoadingTitle: ['card', 'empty'],
  historyLoadingCount: ['card', 'empty'],
  historyTxid: ['historyRow'],
  viewTxText: ['viewTxBadge'],
  tileValue: ['tile'],
  settingsBackText: ['settingsBackButton'],
  settingsNavigationLabel: ['settingsNavigationRow'],
  settingsNavigationLabelDanger: ['settingsNavigationRowDanger'],
  settingsChevron: ['settingsNavigationRow'],
  settingsExternalLink: ['settingsNavigationRow'],
  settingsValueText: ['settingsValue'],
  networkStatusConnected: ['settingsValue'],
  networkStatusSyncing: ['settingsValue'],
  networkStatusError: ['settingsValue'],
  settingsWarning: ['settingsOptionPanel'],
  settingsChoiceText: ['settingsChoice'],
  settingsChoiceTextActive: ['settingsChoiceActive'],
  scannerTitle: ['scannerSafeArea'],
  scannerHint: ['scannerSafeArea'],
  scannerError: ['scannerSafeArea'],
  scannerCloseButtonText: ['scannerCloseButton'],
};

/**
 * Component structure narrows these translucent containers to one real base.
 * settingsChoice/Active deliberately use the panel surface: both are rendered
 * inside settingsOptionPanel, which is the marginal amber/blue case.
 */
const CONTAINER_BASE_SURFACE_RESTRICTIONS: Partial<
  Record<StyleName, readonly BaseSurfaceStyleName[]>
> = {
  languageSettingsButton: ['balanceCard'],
  languageOption: ['balanceCard'],
  languageOptionActive: ['balanceCard'],
  loadingOverlay: ['screen'],
  hero: ['screen'],
  card: ['screen'],
  refreshButton: ['balanceCard'],
  recipientCard: ['balanceCard'],
  addRecipientButton: ['balanceCard'],
  scanButton: ['balanceCard'],
  maxButton: ['balanceCard'],
  passwordField: ['balanceCard'],
  passwordToggle: ['balanceCard'],
  seedVisibilityButton: ['balanceCard'],
  notice: ['balanceCard'],
  balanceCard: ['screen'],
  preview: ['balanceCard'],
  txBox: ['balanceCard'],
  empty: ['balanceCard'],
  historyPageButton: ['balanceCard'],
  historyRow: ['balanceCard'],
  viewTxBadge: ['balanceCard'],
  tile: ['balanceCard'],
  settingsBackButton: ['balanceCard'],
  settingsNavigationRow: ['balanceCard'],
  settingsNavigationRowDanger: ['balanceCard'],
  settingsValue: ['balanceCard'],
  settingsOptionPanel: ['balanceCard'],
  settingsChoice: ['tabs'],
  settingsChoiceActive: ['tabs'],
  scannerSafeArea: ['screen'],
  scannerCloseButton: ['screen'],
};

/**
 * These are real rendering restrictions, not contrast bypasses:
 * - Feedback.error is a direct ScrollView child in App.tsx, so its red tint can
 *   only composite over the page, never over a card or inset panel.
 * - seedWordError exists only inside ImportScreen's card.
 * - the danger navigation row exists only in the settings card, not a panel.
 */
const TEXT_BASE_SURFACE_RESTRICTIONS: Partial<
  Record<StyleName, readonly BaseSurfaceStyleName[]>
> = {
  error: ['screen'],
  seedWordError: ['balanceCard'],
  settingsNavigationLabelDanger: ['balanceCard'],
};

/**
 * WCAG 1.4.3 excludes inactive controls, so buttonTextDisabled is intentionally
 * not measured. The opacity-only disabled containers (refresh, scan, max,
 * history pagination and settings choices) reuse text styles whose enabled
 * rendering is still measured here.
 *
 * balanceHourglass is purely decorative: the adjacent localized
 * balanceUpdatingText conveys the complete status without the glyph.
 */
const CONTRAST_EXEMPT_TEXT_STYLES = new Set<StyleName>([
  'buttonTextDisabled',
  'balanceHourglass',
]);

const TEXT_STYLES_WITHOUT_BASE_SURFACES = new Set<StyleName>([
  // White active-tab text is rendered only on tabActive's opaque blue fill.
  'tabTextActive',
]);

const BASE_SURFACE_TEXT_STYLES = new Set<StyleName>([
  // Field errors are direct siblings of inputs in cards and inset panels.
  'fieldError',
  // Settings headers are direct card children with no additional fill.
  'settingsHeaderTitle',
]);

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

  it('keeps every light-sheet text/background pair above WCAG AA contrast', () => {
    const light = createStyles('light') as unknown as StyleMap;
    const baseSurfaces = Object.fromEntries(
      BASE_SURFACE_STYLE_NAMES.map((styleName) => {
        const background = light[styleName]?.backgroundColor;
        if (typeof background !== 'string' || background === 'transparent') {
          throw new Error(`Missing opaque base surface on ${styleName}`);
        }
        const parsed = parseColor(background);
        if (parsed.alpha !== 1) throw new Error(`Base surface ${styleName} is translucent`);
        return [styleName, parsed];
      }),
    ) as Record<BaseSurfaceStyleName, RgbaColor>;
    const failures: string[] = [];
    let measuredPairs = 0;

    const measure = (
      textStyleName: StyleName,
      foreground: RgbaColor,
      contextName: string,
      background: RgbaColor,
    ) => {
      measuredPairs += 1;
      const ratio = contrastRatio(foreground, background);
      if (ratio < 4.5) {
        failures.push(`${textStyleName} on ${contextName}: ${ratio.toFixed(2)}:1`);
      }
    };

    for (const [textStyleName, declarations] of Object.entries(light)) {
      const foregroundValue = declarations.color;
      if (typeof foregroundValue !== 'string') continue;
      if (CONTRAST_EXEMPT_TEXT_STYLES.has(textStyleName as StyleName)) continue;

      const styleName = textStyleName as StyleName;
      const foreground = parseColor(foregroundValue);
      const permittedBaseNames = TEXT_BASE_SURFACE_RESTRICTIONS[styleName]
        ?? BASE_SURFACE_STYLE_NAMES;
      const containerNames = new Set<StyleName>(TEXT_CONTAINER_CONTEXTS[styleName] ?? []);
      const ownBackground = declarations.backgroundColor;
      const hasOwnBackground = typeof ownBackground === 'string'
        && ownBackground !== 'transparent';
      if (
        containerNames.size === 0
        && !hasOwnBackground
        && !BASE_SURFACE_TEXT_STYLES.has(styleName)
      ) {
        failures.push(`${styleName}: unresolved text background`);
      }

      if (!TEXT_STYLES_WITHOUT_BASE_SURFACES.has(styleName)) {
        for (const baseName of permittedBaseNames) {
          measure(styleName, foreground, baseName, baseSurfaces[baseName]);
        }
      }

      if (hasOwnBackground) {
        containerNames.add(styleName);
      }

      for (const containerName of containerNames) {
        const backgroundValue = light[containerName]?.backgroundColor;
        if (typeof backgroundValue !== 'string' || backgroundValue === 'transparent') continue;
        const backgroundLayer = parseColor(backgroundValue);
        const containerBaseNames = CONTAINER_BASE_SURFACE_RESTRICTIONS[containerName]
          ?? permittedBaseNames;
        if (backgroundLayer.alpha === 1) {
          measure(styleName, foreground, containerName, backgroundLayer);
          continue;
        }
        for (const baseName of containerBaseNames) {
          measure(
            styleName,
            foreground,
            `${containerName} over ${baseName}`,
            compositeColor(backgroundLayer, baseSurfaces[baseName]),
          );
        }
      }
    }

    expect(measuredPairs).toBeGreaterThan(Object.keys(light).length);
    expect(failures).toEqual([]);
  });
});

describe('inline theme colours', () => {
  // Colours passed as props rather than through the stylesheet escape the
  // coverage check above. Scanning the sources keeps them under the same rule:
  // an unmapped literal would silently stay dark on paper.
  const sources = [tabsSource, screensSource, componentsSource, settingsSource, diceSource].join('\n');

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
