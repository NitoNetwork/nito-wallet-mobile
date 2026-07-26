import { describe, expect, it } from 'vitest';

import type { ElectrumBalance, ElectrumHistoryEntry, ElectrumUtxo } from '../network/electrum';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import { deriveP2wpkhAddress, refreshKnownUsedAddresses, scanP2wpkhAccount } from './transparentScan';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const crypto = createNitoWalletCryptoTestDouble();
const regularTransaction = `0100000001${'11'.repeat(32)}000000000100ffffffff0000000000`;

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
      async getTransactionHex(): Promise<string> {
        return regularTransaction;
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

  it('retries a failed history read before treating an address as unused', async () => {
    const targetAddress = (await deriveP2wpkhAddress(mnemonic, 'external', 0, crypto)).address;
    let targetAttempts = 0;
    const fakeReader = {
      async getAddressBalance(): Promise<ElectrumBalance> {
        return { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressUtxos(): Promise<ElectrumUtxo[]> {
        return [];
      },
      async getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]> {
        if (address === targetAddress) {
          targetAttempts += 1;
          if (targetAttempts < 3) {
            throw new Error('temporary Electrum failure');
          }
        }
        return [];
      },
    };

    const snapshot = await scanP2wpkhAccount({
      mnemonic,
      electrum: fakeReader,
      gapLimit: 1,
      crypto,
    });

    expect(targetAttempts).toBe(3);
    expect(snapshot.addresses.find((address) => address.address === targetAddress)?.used).toBe(false);
  });

  it('rejects an incomplete scan after persistent history failures', async () => {
    const targetAddress = (await deriveP2wpkhAddress(mnemonic, 'external', 0, crypto)).address;
    let targetAttempts = 0;
    const fakeReader = {
      async getAddressBalance(): Promise<ElectrumBalance> {
        return { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressUtxos(): Promise<ElectrumUtxo[]> {
        return [];
      },
      async getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]> {
        if (address === targetAddress) {
          targetAttempts += 1;
          throw new Error('persistent Electrum failure');
        }
        return [];
      },
    };

    await expect(scanP2wpkhAccount({
      mnemonic,
      electrum: fakeReader,
      gapLimit: 1,
      crypto,
    })).rejects.toThrow('Transparent wallet scan incomplete');
    expect(targetAttempts).toBe(3);
  });

  it('rejects an incomplete scan instead of treating failed UTXO reads as a zero balance', async () => {
    const targetAddress = (await deriveP2wpkhAddress(mnemonic, 'external', 0, crypto)).address;
    let targetAttempts = 0;
    const fakeReader = {
      async getAddressBalance(): Promise<ElectrumBalance> {
        return { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressUtxos(address: string): Promise<ElectrumUtxo[]> {
        if (address === targetAddress) {
          targetAttempts += 1;
          throw new Error('persistent listunspent failure');
        }
        return [];
      },
      async getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]> {
        return address === targetAddress
          ? [{ txid: 'e'.repeat(64), height: 200, address }]
          : [];
      },
    };

    await expect(scanP2wpkhAccount({
      mnemonic,
      electrum: fakeReader,
      gapLimit: 1,
      crypto,
    })).rejects.toThrow('Transparent wallet scan incomplete');
    expect(targetAttempts).toBe(3);
  });

  it('bounds legacy transaction hydration even when one address has many UTXOs', async () => {
    const [legacyAddress] = await crypto.deriveAddresses(mnemonic, [{
      path: "m/44'/0'/0'/0/0",
      scriptType: 'p2pkh',
    }]);
    let inFlight = 0;
    let peakInFlight = 0;
    const fakeReader = {
      async getAddressBalance(): Promise<ElectrumBalance> {
        return { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]> {
        return address === legacyAddress?.address
          ? [{ txid: 'f'.repeat(64), height: 100, address }]
          : [];
      },
      async getAddressUtxos(address: string): Promise<ElectrumUtxo[]> {
        if (address !== legacyAddress?.address) return [];
        return Array.from({ length: 12 }, (_, index) => ({
          txid: index.toString(16).padStart(64, '0'),
          vout: 0,
          valueSats: 100,
          height: 1,
          address,
          confirmations: 200,
        }));
      },
      async getTransactionHex(): Promise<string> {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return '00';
      },
    };

    await scanP2wpkhAccount({
      mnemonic,
      electrum: fakeReader,
      gapLimit: 1,
      crypto,
    });

    expect(peakInFlight).toBeLessThanOrEqual(6);
  });

  it('rejects the scan when legacy transaction hydration fails', async () => {
    const [legacyAddress] = await crypto.deriveAddresses(mnemonic, [{
      path: "m/44'/0'/0'/0/0",
      scriptType: 'p2pkh',
    }]);
    const fakeReader = {
      async getAddressBalance(): Promise<ElectrumBalance> {
        return { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]> {
        return address === legacyAddress?.address
          ? [{ txid: 'f'.repeat(64), height: 100, address }]
          : [];
      },
      async getAddressUtxos(address: string): Promise<ElectrumUtxo[]> {
        return address === legacyAddress?.address
          ? [{
              txid: 'f'.repeat(64),
              vout: 0,
              valueSats: 100,
              height: 1,
              address,
              confirmations: 200,
            }]
          : [];
      },
      async getTransactionHex(): Promise<string> {
        throw new Error('legacy transaction unavailable');
      },
    };

    await expect(scanP2wpkhAccount({
      mnemonic,
      electrum: fakeReader,
      gapLimit: 1,
      crypto,
    })).rejects.toThrow('legacy transaction unavailable');
  });

  it('reports address progress through the complete cold scan', async () => {
    const progress: { done: number; total: number }[] = [];
    const fakeReader = {
      async getAddressBalance(): Promise<ElectrumBalance> {
        return { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressUtxos(): Promise<ElectrumUtxo[]> {
        return [];
      },
      async getAddressHistory(): Promise<ElectrumHistoryEntry[]> {
        return [];
      },
    };

    const snapshot = await scanP2wpkhAccount({
      mnemonic,
      electrum: fakeReader,
      gapLimit: 2,
      crypto,
      onProgress: (done, total) => progress.push({ done, total }),
    });

    expect(progress.at(-1)).toEqual({ done: snapshot.addresses.length, total: snapshot.addresses.length });
  });

  it('bounds the refresh of every known used address', async () => {
    const emptyReader = {
      async getAddressBalance(): Promise<ElectrumBalance> {
        return { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressUtxos(): Promise<ElectrumUtxo[]> {
        return [];
      },
      async getAddressHistory(): Promise<ElectrumHistoryEntry[]> {
        return [];
      },
    };
    const initial = await scanP2wpkhAccount({
      mnemonic,
      electrum: emptyReader,
      gapLimit: 2,
      crypto,
    });
    const knownUsed = {
      ...initial,
      addresses: initial.addresses.map((address) => ({ ...address, used: true })),
    };
    let inFlight = 0;
    let peakInFlight = 0;
    const delayedReader = {
      ...emptyReader,
      async getAddressHistory(): Promise<ElectrumHistoryEntry[]> {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return [];
      },
    };

    await refreshKnownUsedAddresses({ snapshot: knownUsed, electrum: delayedReader });

    expect(peakInFlight).toBeLessThanOrEqual(6);
  });

  it('bounds refreshes from a previous full-scan snapshot', async () => {
    const emptyReader = {
      async getAddressBalance(): Promise<ElectrumBalance> {
        return { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 };
      },
      async getAddressUtxos(): Promise<ElectrumUtxo[]> {
        return [];
      },
      async getAddressHistory(): Promise<ElectrumHistoryEntry[]> {
        return [];
      },
    };
    const initial = await scanP2wpkhAccount({
      mnemonic,
      electrum: emptyReader,
      gapLimit: 2,
      crypto,
    });
    let inFlight = 0;
    let peakInFlight = 0;
    const delayedReader = {
      ...emptyReader,
      async getAddressHistory(): Promise<ElectrumHistoryEntry[]> {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return [];
      },
    };

    await scanP2wpkhAccount({
      mnemonic,
      electrum: delayedReader,
      gapLimit: 2,
      previousSnapshot: initial,
      crypto,
    });

    expect(peakInFlight).toBeLessThanOrEqual(6);
  });
});
