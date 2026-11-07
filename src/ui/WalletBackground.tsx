import type { ReactNode } from 'react';
import {
  ImageBackground,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { ThemeName } from './theme';

const AUTH_BACKGROUND = require('../../assets/backgrounds/nito-auth-horizon.png');
const WALLET_BACKGROUND = require('../../assets/backgrounds/nito-wallet-horizon.png');

export type WalletBackgroundVariant = 'auth' | 'wallet';

export function WalletBackground({
  variant,
  theme,
  children,
  style,
}: {
  variant: WalletBackgroundVariant;
  theme: ThemeName;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ImageBackground
      source={variant === 'wallet' ? WALLET_BACKGROUND : AUTH_BACKGROUND}
      resizeMode="cover"
      style={[styles.root, style]}
      imageStyle={styles.image}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          theme === 'light' ? styles.lightVeil : styles.darkVeil,
          variant === 'auth' ? styles.authVeil : styles.walletVeil,
        ]}
      />
      {children}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#020611',
  },
  image: {
    backgroundColor: '#020611',
  },
  darkVeil: {
    backgroundColor: 'rgba(1, 8, 27, 0.24)',
  },
  lightVeil: {
    backgroundColor: 'rgba(248, 251, 255, 0.82)',
  },
  authVeil: {
    opacity: 0.88,
  },
  walletVeil: {
    opacity: 1,
  },
});
