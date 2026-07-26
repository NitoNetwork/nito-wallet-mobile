import { describe, expect, it } from 'vitest';

import type { TransparentWalletSnapshot } from './transparentScan';
import { pendingRefreshAddresses } from './pendingRefresh';

const address = (
  value: string,
  {
    pendingHistory = false,
    confirmations = 101,
    isCoinbase = false,
  }: {
    pendingHistory?: boolean;
    confirmations?: number;
    isCoinbase?: boolean;
  } = {},
): TransparentWalletSnapshot['addresses'][number] => ({
  accountKey: 'bech32',
  accountLabel: 'Bech32',
  accountPath: "m/84'/0'/0'",
  scriptType: 'p2wpkh',
  spendable: true,
  branch: 'external',
  index: 0,
  path: "m/84'/0'/0'/0/0",
  address: value,
  balance: { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 },
  utxos: confirmations === 101 ? [] : [{
    txid: value.padEnd(64, '0').slice(0, 64),
    vout: 0,
    valueSats: 1,
    height: confirmations > 0 ? 1 : 0,
    address: value,
    confirmations,
    isCoinbase,
  }],
  history: pendingHistory ? [{ txid: value.padEnd(64, '1').slice(0, 64), height: 0, address: value }] : [],
  used: pendingHistory || confirmations !== 101,
});

describe('pending refresh selection', () => {
  it('includes a pending self-send address even when it has no remaining UTXO', () => {
    const pendingSelfSend = address('pending-self', { pendingHistory: true });
    const immatureCoinbase = address('immature', { confirmations: 25, isCoinbase: true });
    const settled = address('settled');
    const snapshot = {
      addresses: [pendingSelfSend, immatureCoinbase, settled],
    } as TransparentWalletSnapshot;

    expect(pendingRefreshAddresses(snapshot)).toEqual(['pending-self', 'immature']);
  });
});
