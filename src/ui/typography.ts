/**
 * Native family names embedded by the expo-font config plugin.
 *
 * Each weight has its own family on purpose. Android otherwise synthesizes
 * missing weights differently across API levels, which makes the compact A3
 * layout move between devices.
 */
export const TYPOGRAPHY = {
  regular: 'SpaceGrotesk-Regular',
  medium: 'SpaceGrotesk-Medium',
  semibold: 'SpaceGrotesk-SemiBold',
  bold: 'SpaceGrotesk-Bold',
} as const;

export type TypographyWeight = keyof typeof TYPOGRAPHY;
