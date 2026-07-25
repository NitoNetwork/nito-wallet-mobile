import type { TransparentWalletSnapshot } from '../wallet/transparentScan';

export type AppScreen = 'loading' | 'landing' | 'unlock' | 'import' | 'wallet' | 'persist';
export type WalletTab = 'home' | 'receive' | 'send' | 'history' | 'security';
export type BiometricMethod = 'Face ID' | 'Touch ID' | 'biometrics';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger' | 'disabled';

export type PendingAction =
  | 'create'
  | 'import'
  | 'unlock'
  | 'protect'
  | 'copy'
  | 'max'
  | 'consolidate'
  | 'prepare'
  | 'broadcast'
  | 'broadcastConsolidation'
  | 'history'
  | 'reveal'
  | 'delete'
  | 'lock';

export type Wallet = {
  mnemonic: string;
  address: string;
  derivationPath: string;
};

export type NetworkState = {
  status: 'idle' | 'syncing' | 'connected' | 'error';
  snapshot: TransparentWalletSnapshot | null;
  error: string;
  serverUrl: string;
  height: number;
  fullHistoryEnabled: boolean;
};
