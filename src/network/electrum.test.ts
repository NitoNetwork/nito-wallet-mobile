import { describe, expect, it } from 'vitest';

import {
  addressToElectrumScripthash,
  electrumScripthashFromScript,
  NitoElectrumClient,
  scriptPubKeyForNitoAddress,
} from './electrum';

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('Nito Electrum helpers', () => {
  const address = 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02';

  it('builds the P2WPKH scriptPubKey expected by ElectrumX', () => {
    const script = scriptPubKeyForNitoAddress(address);
    expect(toHex(script)).toBe('0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2');
  });

  it('uses reversed sha256(scriptPubKey) for Electrum scripthash', () => {
    const script = scriptPubKeyForNitoAddress(address);
    expect(electrumScripthashFromScript(script)).toBe('6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a');
    expect(addressToElectrumScripthash(address)).toBe('6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a');
  });

  it('notifies listeners exactly once for each strictly newer block height', () => {
    const client = new NitoElectrumClient();
    client.blockHeight = 100;
    const updates: [number, number][] = [];
    const unsubscribe = client.subscribeBlockHeight((height, previous) => updates.push([height, previous]));
    const handleMessage = (client as unknown as { handleMessage(raw: string): void }).handleMessage.bind(client);

    handleMessage(JSON.stringify({ method: 'blockchain.headers.subscribe', params: [{ height: 100 }] }));
    handleMessage(JSON.stringify({ method: 'blockchain.headers.subscribe', params: [{ height: 101 }] }));
    handleMessage(JSON.stringify({ method: 'blockchain.headers.subscribe', params: [{ height: 101 }] }));
    unsubscribe();
    handleMessage(JSON.stringify({ method: 'blockchain.headers.subscribe', params: [{ height: 102 }] }));

    expect(updates).toEqual([[101, 100]]);
  });
});
