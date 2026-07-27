export const NativeModules: Record<string, unknown> = {};

/**
 * Minimal surface needed by the style layer under Vitest. React Native's real
 * StyleSheet.create returns its input, so the identity implementation keeps the
 * stylesheet shape and values exactly as the app sees them.
 */
export const StyleSheet = {
  create: <T extends Record<string, object>>(styles: T): T => styles,
};

export const Platform = {
  OS: 'ios' as const,
  select: <T,>(options: { ios?: T; android?: T; default?: T }): T | undefined =>
    options.ios ?? options.default,
};
