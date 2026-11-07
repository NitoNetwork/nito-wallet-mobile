import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
export type { Wallet } from '../wallet/walletIdentity';

export type AppScreen =
  | 'loading'
  | 'initializationError'
  | 'landing'
  | 'create'
  | 'dice'
  | 'unlock'
  | 'import'
  | 'wallet'
  | 'persist';
export type WalletTab = 'home' | 'receive' | 'send' | 'history' | 'security';
export type BiometricMethod = 'Face ID' | 'Touch ID' | 'biometrics';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'disabled';

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
  | 'electrumServer'
  | 'history'
  | 'resynchronizeHistory'
  | 'reveal'
  | 'delete';

export type NetworkState = {
  status: 'idle' | 'syncing' | 'connected' | 'error';
  snapshot: TransparentWalletSnapshot | null;
  error: string;
  serverUrl: string;
  height: number;
  fullHistoryEnabled: boolean;
};
