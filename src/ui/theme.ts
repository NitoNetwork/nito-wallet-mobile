export type ThemeName = 'dark' | 'light';

export const THEME_NAMES = ['dark', 'light'] as const;
export const DEFAULT_THEME: ThemeName = 'dark';

export const isThemeName = (value: unknown): value is ThemeName =>
  THEME_NAMES.some((name) => name === value);

/**
 * The dark theme is the reference: every style literal below is the value the
 * wallet has always rendered. The light theme is expressed purely as a
 * substitution table, so switching cannot alter a single dark pixel — there is
 * no second copy of the styles to drift out of sync.
 *
 * The light palette is a warm paper look rather than a clinical white: cream
 * surfaces, warm grey borders, near-black-but-not-black text. Theme tests
 * derive every text/background pair, composite translucent fills over their
 * real surfaces, and enforce WCAG AA contrast.
 */
export const LIGHT_COLOR_MAP: Readonly<Record<string, string>> = {
  // Surfaces — page, cards, inset panels, overlays.
  '#01040b': '#f4f1ea',
  '#020611': '#f4f1ea',
  '#061020': '#eae5da',
  '#071326': '#fbf9f4',
  '#0b203a': '#eae5da',
  '#161f31': '#eae5da',
  '#39111c': '#fdecea',
  '#f8fbff': '#fbf9f4',
  'rgba(8, 18, 38, 0.92)': 'rgba(251, 249, 244, 0.96)',
  'rgba(9, 18, 33, 0.94)': 'rgba(251, 249, 244, 0.96)',
  'rgba(3, 9, 20, 0.82)': 'rgba(234, 229, 218, 0.86)',
  'rgba(2, 6, 17, 0.62)': 'rgba(234, 229, 218, 0.62)',
  'rgba(2, 6, 17, 0.72)': 'rgba(234, 229, 218, 0.72)',
  'rgba(2, 6, 17, 0.82)': 'rgba(234, 229, 218, 0.86)',
  'rgba(2, 6, 17, 0.94)': 'rgba(244, 241, 234, 0.96)',
  'rgba(7, 19, 38, 0.38)': 'rgba(234, 229, 218, 0.55)',
  'rgba(117, 139, 171, 0.12)': 'rgba(28, 26, 23, 0.06)',

  // Accent fills — primary action, selected tab.
  '#1f75d6': '#1f6fd6',
  'rgba(32, 118, 220, 0.12)': 'rgba(31, 111, 214, 0.10)',
  'rgba(32, 118, 220, 0.18)': 'rgba(31, 111, 214, 0.14)',
  'rgba(32, 118, 220, 0.22)': 'rgba(31, 111, 214, 0.18)',

  // Amber — transaction actions and warnings.
  '#f5bd31': '#e8a317',
  'rgba(245, 189, 49, 0.16)': 'rgba(232, 163, 23, 0.16)',
  'rgba(245, 189, 49, 0.52)': 'rgba(168, 106, 0, 0.55)',
  'rgba(246, 196, 79, 0.09)': 'rgba(232, 163, 23, 0.10)',
  'rgba(246, 196, 79, 0.10)': 'rgba(232, 163, 23, 0.12)',
  'rgba(246, 196, 79, 0.16)': 'rgba(232, 163, 23, 0.18)',
  'rgba(246, 196, 79, 0.22)': 'rgba(168, 106, 0, 0.32)',
  'rgba(246, 196, 79, 0.24)': 'rgba(168, 106, 0, 0.36)',
  'rgba(246, 196, 79, 0.58)': 'rgba(168, 106, 0, 0.62)',

  // Danger.
  'rgba(48, 9, 18, 0.74)': 'rgba(253, 236, 234, 0.92)',
  'rgba(99, 20, 34, 0.28)': 'rgba(179, 38, 30, 0.14)',
  'rgba(255, 86, 110, 0.14)': 'rgba(179, 38, 30, 0.10)',
  'rgba(255, 86, 110, 0.32)': 'rgba(179, 38, 30, 0.34)',
  'rgba(255, 86, 110, 0.34)': 'rgba(179, 38, 30, 0.36)',
  'rgba(255, 86, 110, 0.42)': 'rgba(179, 38, 30, 0.44)',
  'rgba(255, 86, 110, 0.48)': 'rgba(179, 38, 30, 0.50)',

  // Success.
  'rgba(37, 181, 121, 0.12)': 'rgba(27, 122, 75, 0.10)',
  'rgba(37, 181, 121, 0.14)': 'rgba(27, 122, 75, 0.12)',
  'rgba(37, 181, 121, 0.32)': 'rgba(27, 122, 75, 0.34)',
  'rgba(37, 181, 121, 0.36)': 'rgba(27, 122, 75, 0.38)',

  // Borders — neutral.
  '#6ab0ff': '#1663c7',
  'rgba(126, 151, 188, 0.14)': 'rgba(28, 26, 23, 0.10)',
  'rgba(126, 151, 188, 0.16)': 'rgba(28, 26, 23, 0.12)',
  'rgba(126, 151, 188, 0.2)': 'rgba(28, 26, 23, 0.14)',
  'rgba(126, 151, 188, 0.22)': 'rgba(28, 26, 23, 0.16)',
  'rgba(126, 151, 188, 0.28)': 'rgba(28, 26, 23, 0.18)',
  'rgba(126, 151, 188, 0.32)': 'rgba(28, 26, 23, 0.20)',
  'rgba(155, 180, 217, 0.16)': 'rgba(28, 26, 23, 0.12)',
  'rgba(155, 180, 217, 0.18)': 'rgba(28, 26, 23, 0.14)',
  'rgba(185, 204, 237, 0.12)': 'rgba(28, 26, 23, 0.10)',
  'rgba(185, 204, 237, 0.14)': 'rgba(28, 26, 23, 0.12)',

  // Borders — accent blue.
  'rgba(75, 157, 255, 0.26)': 'rgba(22, 99, 199, 0.24)',
  'rgba(75, 157, 255, 0.32)': 'rgba(22, 99, 199, 0.30)',
  'rgba(75, 157, 255, 0.38)': 'rgba(22, 99, 199, 0.36)',
  'rgba(75, 157, 255, 0.42)': 'rgba(22, 99, 199, 0.40)',
  'rgba(75, 157, 255, 0.64)': 'rgba(22, 99, 199, 0.62)',
  'rgba(91, 166, 255, 0.24)': 'rgba(22, 99, 199, 0.22)',
  'rgba(91, 166, 255, 0.28)': 'rgba(22, 99, 199, 0.26)',
  'rgba(91, 166, 255, 0.34)': 'rgba(22, 99, 199, 0.32)',
  'rgba(91, 166, 255, 0.42)': 'rgba(22, 99, 199, 0.40)',
  'rgba(91, 166, 255, 0.54)': 'rgba(22, 99, 199, 0.52)',

  // Text — primary, secondary, muted.
  '#f6f8ff': '#1c1a17',
  '#f7faff': '#1c1a17',
  '#ffffff': '#ffffff',
  '#eef4ff': '#1c1a17',
  '#bdc9df': '#3d3831',
  '#aebbd0': '#4a443c',
  '#9fb4d3': '#575046',
  '#91a4c3': '#6b6459',
  '#8ea0bd': '#6b6459',
  '#8390a8': '#6b6459',
  '#748198': '#9a9287',
  '#0b101d': '#1c1a17',

  // Text — accent blue.
  '#dbeaff': '#0d51aa',
  '#8cc6ff': '#0d51aa',
  '#7fb9ff': '#0d51aa',
  '#73b9ff': '#0d51aa',

  // Text — amber, success, danger.
  '#f6c44f': '#805000',
  '#ffc52f': '#805000',
  '#ffc66d': '#805000',
  '#ffdc81': '#805000',
  '#fff4d6': '#1c1a17',
  '#d3c7a1': '#6b6459',
  '#55d99a': '#146138',
  '#d8ffef': '#146138',
  '#ff7f92': '#b3261e',
  '#ff97a7': '#b3261e',
  '#ff9baa': '#b3261e',

  // Shadows — the dark theme glows blue; paper takes a short neutral drop.
  '#0b62c7': '#1c1a17',
  '#2f81f7': '#1c1a17',

  // Inline colours used outside the stylesheet.
  '#6d7892': '#9a9287',
};

/** Shared A3 palette tokens. Every token is present in LIGHT_COLOR_MAP. */
export const A3_COLORS = {
  panel: 'rgba(2, 6, 17, 0.82)',
  panelSoft: 'rgba(2, 6, 17, 0.72)',
  border: 'rgba(75, 157, 255, 0.42)',
  borderSoft: 'rgba(75, 157, 255, 0.38)',
  primaryText: '#f6f8ff',
  secondaryText: '#9fb4d3',
  bodyText: '#bdc9df',
  blueText: '#8cc6ff',
  blueTextStrong: '#dbeaff',
  amber: '#f5bd31',
  amberText: '#ffc52f',
  amberBorder: 'rgba(246, 196, 79, 0.58)',
  buttonText: '#0b101d',
  success: '#55d99a',
  busy: '#ffc66d',
  danger: '#ff7f92',
} as const;

/**
 * The QR code cannot go through LIGHT_COLOR_MAP: its foreground shares a literal
 * with a card surface, and surfaces invert between themes. A code whose modules
 * inverted with the background would stop scanning, so the pair is explicit.
 * The dark values are exactly the ones the wallet has always drawn.
 */
export const QR_COLORS: Readonly<Record<ThemeName, { foreground: string; background: string }>> = {
  dark: { foreground: '#071326', background: '#f8fbff' },
  light: { foreground: '#1c1a17', background: '#fbf9f4' },
};

/**
 * The dark theme returns its input untouched, which is what makes the
 * no-regression guarantee structural rather than merely tested.
 */
export const themeColor = (theme: ThemeName, color: string): string => (
  theme === 'dark' ? color : LIGHT_COLOR_MAP[color] ?? color
);

type StyleValue = unknown;

const isColorLiteral = (value: unknown): value is string =>
  typeof value === 'string' && (value.startsWith('#') || value.startsWith('rgba('));

/**
 * The dark theme leans on wide blue glows (opacity 0.25, radius 28). Recolouring
 * them alone would leave a heavy smudge on paper, so light also softens the
 * geometry: a short, faint drop, like a sheet lying on a desk. Values already
 * softer than the cap are left alone, and shadowless styles stay shadowless.
 */
const LIGHT_MAX_SHADOW_OPACITY = 0.08;
const LIGHT_MAX_SHADOW_RADIUS = 10;
const LIGHT_MAX_ELEVATION = 3;

const lightShadowValue = (property: string, value: unknown): unknown => {
  if (typeof value !== 'number' || value === 0) return value;
  if (property === 'shadowOpacity') return Math.min(value, LIGHT_MAX_SHADOW_OPACITY);
  if (property === 'shadowRadius') return Math.min(value, LIGHT_MAX_SHADOW_RADIUS);
  if (property === 'elevation') return Math.min(value, LIGHT_MAX_ELEVATION);
  return value;
};

/**
 * Walks a raw style object and substitutes every colour literal. Non-colour
 * values are returned by reference, so shapes and numbers cannot drift.
 */
export const mapStyleColors = <T extends Record<string, object>>(
  raw: T,
  theme: ThemeName,
): T => {
  if (theme === 'dark') return raw;

  const mapped: Record<string, Record<string, StyleValue>> = {};
  for (const [styleName, declarations] of Object.entries(raw)) {
    const nextDeclarations: Record<string, StyleValue> = {};
    for (const [property, value] of Object.entries(declarations as Record<string, StyleValue>)) {
      nextDeclarations[property] = isColorLiteral(value)
        ? themeColor(theme, value)
        : lightShadowValue(property, value);
    }
    mapped[styleName] = nextDeclarations;
  }
  return mapped as T;
};

/** Every colour literal a raw stylesheet uses, for coverage checking. */
export const collectStyleColors = (
  raw: Record<string, object>,
): string[] => {
  const colors = new Set<string>();
  for (const declarations of Object.values(raw)) {
    for (const value of Object.values(declarations as Record<string, StyleValue>)) {
      if (isColorLiteral(value)) colors.add(value);
    }
  }
  return [...colors];
};
