import { describe, expect, it } from 'vitest';

import type { ElectrumBalance, ElectrumHistoryEntry, ElectrumUtxo } from '../network/electrum';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import { deriveP2wpkhAddress, refreshKnownUsedAddresses, scanP2wpkhAccount } from './transparentScan';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const crypto = createNitoWalletCryptoTestDouble();

describe('transparent HD scan', () => {
  it('derives the same primary Bech32 address as the web wallet', async () => {
    expect((await deriveP2wpkhAddress(mnemonic, 'external', 0, crypto)).address).toBe(
      'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02',
    );
  });

  it('scans external and internal branches until the configured gap limit', async () => {
    const usedAddress = (await deriveP2wpkhAddress(mnemonic, 'external', 1, crypto)).address;
    const fakeReader = {
      async getAddressBalance(address: string): Promise<ElectrumBalance> {
        return address === usedAddress
          ? { confirmedSats: 125_000_000, unconfirmedSats: 25_000_000, totalSats: 150_000_000 }
          : { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressUtxos(address: string): Promise<ElectrumUtxo[]> {
        return address === usedAddress
          ? [
              { txid: 'a'.repeat(64), vout: 0, valueSats: 125_000_000, height: 100, address, confirmations: 4, isCoinbase: false },
              { txid: 'c'.repeat(64), vout: 1, valueSats: 25_000_000, height: 0, address, confirmations: 0, isCoinbase: false },
            ]
          : [];
      },
      async getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]> {
        return address === usedAddress
          ? [
              { txid: 'a'.repeat(64), height: 100, address },
              { txid: 'b'.repeat(64), height: 90, address },
              { txid: 'c'.repeat(64), height: 0, address },
            ]
          : [];
      },
    };

    const snapshot = await scanP2wpkhAccount({ mnemonic, electrum: fakeReader, gapLimit: 2, crypto });

    expect(snapshot.confirmedSats).toBe(125_000_000);
    expect(snapshot.unconfirmedSats).toBe(25_000_000);
    expect(snapshot.balanceSats).toBe(150_000_000);
    expect(snapshot.spendableSats).toBe(125_000_000);
    expect(snapshot.usedAddresses).toHaveLength(1);
    expect(snapshot.utxos).toHaveLength(2);
    expect(snapshot.history.map((entry) => entry.txid)).toEqual(['a'.repeat(64)]);
    expect(snapshot.addresses.some((address) => address.branch === 'internal')).toBe(true);

    const fullHistorySnapshot = await scanP2wpkhAccount({
      mnemonic,
      electrum: fakeReader,
      crypto,
      includeHistory: true,
      gapLimit: 2,
    });
    expect(fullHistorySnapshot.history.map((entry) => entry.txid)).toEqual([
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
    ]);
  });

  it('refreshes a pending known address without deriving or scanning new gap addresses', async () => {
    const usedAddress = (await deriveP2wpkhAddress(mnemonic, 'external', 0, crypto)).address;
    let confirmed = false;
    let historyCalls = 0;
    const fakeReader = {
      async getAddressBalance(): Promise<ElectrumBalance> {
        return { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressUtxos(address: string): Promise<ElectrumUtxo[]> {
        if (address !== usedAddress) return [];
        return [{
          txid: 'd'.repeat(64),
          vout: 0,
          valueSats: 50_000_000,
          height: confirmed ? 101 : 0,
          address,
          confirmations: confirmed ? 1 : 0,
          isCoinbase: false,
        }];
      },
      async getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]> {
        historyCalls += 1;
        return address === usedAddress ? [{ txid: 'd'.repeat(64), height: confirmed ? 101 : 0, address }] : [];
      },
    };
    const initial = await scanP2wpkhAccount({ mnemonic, electrum: fakeReader, gapLimit: 1, crypto });
    confirmed = true;
    historyCalls = 0;
    const refreshed = await refreshKnownUsedAddresses({ snapshot: initial, electrum: fakeReader });

    expect(refreshed.unconfirmedSats).toBe(0);
    expect(refreshed.confirmedSats).toBe(50_000_000);
    expect(historyCalls).toBe(1);
  });
});
