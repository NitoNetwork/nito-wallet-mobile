import { describe, expect, it } from 'vitest';

import {
  bindBip39Passphrase,
  createNitoWalletCryptoBridge,
  NitoWalletCryptoUnavailableError,
} from './nitoWalletCryptoContract';

describe('Nito Wallet Rust bridge contract', () => {
  it('fails closed when the native library is absent', async () => {
    const bridge = createNitoWalletCryptoBridge(null);
    await expect(
      bridge.deriveAddresses('abandon '.repeat(12).trim(), [{ path: "m/84'/0'/0'/0/0", scriptType: 'p2wpkh' }]),
    ).rejects.toBeInstanceOf(NitoWalletCryptoUnavailableError);
  });

  it('normalizes and forwards the optional BIP39 passphrase for derivation and signing', async () => {
    const requests: { operation: string; request: unknown }[] = [];
    const bridge = createNitoWalletCryptoBridge({
      async invoke(operation, requestJson) {
        requests.push({ operation, request: JSON.parse(requestJson) });
        const result = operation === 'deriveAddresses' ? [] : { psbtBase64: 'AA==' };
        return JSON.stringify({ ok: true, result });
      },
    });
    const protectedBridge = bindBip39Passphrase(bridge, 'é');

    await protectedBridge.deriveAddresses('test mnemonic', []);
    await protectedBridge.signPsbt({
      mnemonic: 'test mnemonic',
      psbtBase64: 'AA==',
      signers: [],
    });

    expect(requests).toEqual([
      {
        operation: 'deriveAddresses',
        request: { mnemonic: 'test mnemonic', bip39Passphrase: 'e\u0301', requests: [] },
      },
      {
        operation: 'signPsbt',
        request: {
          mnemonic: 'test mnemonic',
          psbtBase64: 'AA==',
          signers: [],
          bip39Passphrase: 'e\u0301',
        },
      },
    ]);
  });

  it('delegates operations through the single native ABI', async () => {
    const operations: string[] = [];
    const bridge = createNitoWalletCryptoBridge({
      async invoke(operation) {
        operations.push(operation);
        return JSON.stringify({ ok: true, result: { keyBase64: 'AA==' } });
      },
    });
    await expect(bridge.pbkdf2({ password: 'secret', saltBase64: 'AA==', rounds: 1, outputLength: 1 }))
      .resolves.toEqual({ keyBase64: 'AA==' });
    expect(operations).toEqual(['pbkdf2']);
  });

  it('exposes native entropy and mnemonic generation without returning raw seed entropy', async () => {
    const requests: { operation: string; request: string }[] = [];
    const bridge = createNitoWalletCryptoBridge({
      async invoke(operation, request) {
        requests.push({ operation, request });
        const result = operation === 'randomBytes'
          ? { bytesBase64: 'AAECAw==' }
          : { mnemonic: 'test mnemonic' };
        return JSON.stringify({ ok: true, result });
      },
    });

    await expect(bridge.randomBytes(4)).resolves.toEqual({ bytesBase64: 'AAECAw==' });
    await expect(bridge.generateMnemonic()).resolves.toEqual({ mnemonic: 'test mnemonic' });
    await expect(bridge.generateMnemonic('AQID')).resolves.toEqual({ mnemonic: 'test mnemonic' });
    expect(requests).toEqual([
      { operation: 'randomBytes', request: '{"length":4}' },
      { operation: 'generateMnemonic', request: '{}' },
      { operation: 'generateMnemonic', request: '{"additionalEntropyBase64":"AQID"}' },
    ]);
  });
});
