import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { createStyles, type WalletStyles } from './styles';
import { DEFAULT_THEME, themeColor, type ThemeName } from './theme';

type ThemeContextValue = {
  theme: ThemeName;
  styles: WalletStyles;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  styles: createStyles(DEFAULT_THEME),
});

export function ThemeProvider({ theme, children }: { theme: ThemeName; children: ReactNode }) {
  const value = useMemo<ThemeContextValue>(
    () => ({ theme, styles: createStyles(theme) }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useStyles = (): WalletStyles => useContext(ThemeContext).styles;

export const useThemeName = (): ThemeName => useContext(ThemeContext).theme;

/** For the few colours passed as props rather than through the stylesheet. */
export const useThemeColor = (): ((color: string) => string) => {
  const theme = useThemeName();
  return (color: string) => themeColor(theme, color);
};
