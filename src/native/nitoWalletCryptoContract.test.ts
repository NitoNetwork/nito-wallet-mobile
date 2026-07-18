import { describe, expect, it } from 'vitest';

import {
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
});
