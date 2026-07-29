import { describe, expect, it } from 'vitest';

import type { TransparentWalletSnapshot } from '../wallet/transparentScan';
import {
  isTransparentWalletSnapshot,
  parseWalletSnapshotCache,
} from './walletSnapshotCache';

const publicSnapshot: TransparentWalletSnapshot = {
  confirmedSats: 150_000_000,
  unconfirmedSats: 0,
  balanceSats: 150_000_000,
  spendableSats: 150_000_000,
  utxos: [{
    txid: '11'.repeat(32),
    vout: 0,
    valueSats: 150_000_000,
    height: 950_000,
    address: 'wallet-address',
    confirmations: 12,
    rawTx: 'raw-transaction',
  }],
  history: [{
    txid: '11'.repeat(32),
    height: 950_000,
    address: 'wallet-address',
  }],
  addresses: [{
    accountKey: 'bech32',
    accountLabel: 'Bech32',
    accountPath: "m/84'/0'/0'",
    scriptType: 'p2wpkh',
    spendable: true,
    branch: 'external',
    index: 0,
    path: "m/84'/0'/0'/0/0",
    address: 'wallet-address',
    balance: {
      confirmedSats: 150_000_000,
      unconfirmedSats: 0,
      totalSats: 150_000_000,
    },
    utxos: [],
    history: [],
    used: true,
  }],
  usedAddresses: [],
  spendableAddresses: [],
  gapLimit: 20,
  scannedAt: '2026-07-29T10:00:00.000Z',
};

describe('wallet snapshot cache validation', () => {
  it('accepts the original public cache shape without coinbase summary fields', () => {
    expect(parseWalletSnapshotCache(JSON.stringify(publicSnapshot))).toEqual(publicSnapshot);
  });

  it('accepts current optional coinbase and enriched history fields', () => {
    const currentSnapshot: TransparentWalletSnapshot = {
      ...publicSnapshot,
      immatureCoinbaseSats: 50_000_000,
      immatureCoinbaseBlocksRemaining: 37,
      history: [{
        ...publicSnapshot.history[0]!,
        direction: 'received',
        amountSats: 150_000_000,
        feeSats: 0,
        counterparty: 'sender-address',
        blockTime: 1_753_786_800,
        provisional: false,
      }],
    };

    expect(isTransparentWalletSnapshot(currentSnapshot)).toBe(true);
  });

  it('rejects malformed JSON and structurally incomplete snapshots', () => {
    expect(() => parseWalletSnapshotCache('{')).toThrow(SyntaxError);
    expect(() => parseWalletSnapshotCache(JSON.stringify({
      ...publicSnapshot,
      spendableAddresses: undefined,
    }))).toThrow('Invalid wallet snapshot cache.');
    expect(() => parseWalletSnapshotCache(JSON.stringify({
      ...publicSnapshot,
      utxos: [{ ...publicSnapshot.utxos[0], valueSats: '150000000' }],
    }))).toThrow('Invalid wallet snapshot cache.');
  });

  it('rejects internally inconsistent cached balances', () => {
    expect(isTransparentWalletSnapshot({
      ...publicSnapshot,
      balanceSats: publicSnapshot.balanceSats - 1,
    })).toBe(false);
    expect(isTransparentWalletSnapshot({
      ...publicSnapshot,
      addresses: [{
        ...publicSnapshot.addresses[0]!,
        balance: {
          ...publicSnapshot.addresses[0]!.balance,
          totalSats: 1,
        },
      }],
    })).toBe(false);
  });
});
