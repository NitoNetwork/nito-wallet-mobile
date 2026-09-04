import * as btc from '@scure/btc-signer';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { pbkdf2Sync } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { decryptVault, encryptVault, type EncryptedVault } from '../services/vaultCrypto';
import { readBiometricSecretForUnlock } from '../services/biometricUnlock';
import { buildNativeCryptoTestBridge, createNativeCryptoTestBridge, invokeNativeCrypto } from '../test/nativeCryptoBridge';
import fixture from '../test/fixtures/vault-1.3.1.json';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import { deriveHdAddress, deriveHdPath, HD_ACCOUNT_TEMPLATES, type HdAccountKey } from '../wallet/hdAddress';
import { restoreLegacyCompatibleWallet } from '../wallet/walletIdentity';
import { NITO_SIGNER_NETWORK, RBF_SEQUENCE, prepareUnsignedTransparentMultiSend, prepareUnsignedTransparentConsolidation, signUnsignedTransparentTx } from '../wallet/transparentSend';
import { loadRbfOriginal, prepareRbfQuote, assertSignedRbfFee } from '../wallet/transparentRbf';
import type { TransactionLifecycleRecord } from '../services/transactionLifecycle';
import type { ScannedAddress, TransparentWalletSnapshot } from '../wallet/transparentScan';

const mnemonic = fixture.payload.mnemonic;
const crypto = createNativeCryptoTestBridge();
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

const fundedWallet = async (family: HdAccountKey, outputCount = 1) => {
  const input = await deriveHdAddress(mnemonic, family, 'external', 0, crypto);
  const change = await deriveHdAddress(mnemonic, 'taproot', 'internal', 1, crypto);
  const destination = await deriveHdAddress(mnemonic, 'bech32', 'external', 5, crypto);
  const scanned = (derived: typeof input): ScannedAddress => ({
    ...derived, accountLabel: derived.accountKey,
    accountPath: derived.path.split('/').slice(0, 4).join('/'), spendable: true, used: true,
    utxos: [], history: [], balance: { confirmedSats: 0, unconfirmedSats: 0, totalSats: 0 },
  });
  const parent = new btc.Transaction();
  for (let index = 0; index < outputCount; index += 1) {
    parent.addOutputAddress(input.address, 100_000_000n / BigInt(outputCount), NITO_SIGNER_NETWORK);
  }
  parent.addInput({ txid: '11'.repeat(32), index: 0, finalScriptSig: new Uint8Array([0]) });
  const rawParent = hex(parent.toBytes(true, true));
  const snapshot: TransparentWalletSnapshot = {
    confirmedSats: 100_000_000, unconfirmedSats: 0, balanceSats: 100_000_000, spendableSats: 100_000_000,
    addresses: [scanned(input), scanned(change)], usedAddresses: [], spendableAddresses: [],
    history: [], gapLimit: 20, scannedAt: new Date(0).toISOString(),
    utxos: Array.from({ length: outputCount }, (_, vout) => ({
      txid: parent.id, vout, valueSats: 100_000_000 / outputCount, address: input.address,
      height: 10, confirmations: 200, isCoinbase: false, rawTx: rawParent,
    })),
  };
  return { input, change, destination, parent, rawParent, snapshot };
};

// Always part of npm test, including CI. No opt-in flag and no simulated signing.
describe('mobile JavaScript contract against the real Rust C ABI', () => {
  beforeAll(buildNativeCryptoTestBridge, 180_000);

  it.each(HD_ACCOUNT_TEMPLATES)('returns the actual JSON contract for $key on both HD branches', async (template) => {
    const requests = ['external', 'internal'].map((branch) => ({
      path: deriveHdPath(template.key, branch as 'external' | 'internal', 3), scriptType: template.scriptType,
    }));
    const raw = JSON.parse(await invokeNativeCrypto('deriveAddresses', JSON.stringify({ mnemonic, requests })));
    expect(raw.ok).toBe(true);
    expect(raw.result).toHaveLength(2);
    const reference = await createNitoWalletCryptoTestDouble().deriveAddresses(mnemonic, requests);
    for (const [index, request] of requests.entries()) {
      expect(raw.result[index]).toEqual({ ...reference[index], ...request });
      const derived = await deriveHdAddress(mnemonic, template.key, index === 0 ? 'external' : 'internal', 3, crypto);
      expect(derived.address).toBe(raw.result[index].address);
      expect(derived.scriptType).toBe(request.scriptType);
    }
  });

  it.each(['password', 'biometric'])('reopens an immutable 1.3.1 vault via %s with real PBKDF2 and restores Taproot without rewriting its contents', async (mode) => {
    const stored = JSON.stringify(fixture.vault);
    const vault = Object.freeze(JSON.parse(stored) as EncryptedVault);
    // Only the OS prompt is substituted. KDF and HD derivation run in Rust.
    const secret = mode === 'biometric'
      ? await readBiometricSecretForUnlock(async () => fixture.password)
      : fixture.password;
    expect(secret).toBe(fixture.password);
    const payload = await decryptVault(vault, secret!, 'invalid', crypto);
    expect(payload).toEqual(fixture.payload);
    const wallet = await restoreLegacyCompatibleWallet(payload, 'taproot', 0, crypto);
    expect(wallet.walletId).toBe(fixture.payload.address);
    expect(wallet.receiveDerivationPath).toBe("m/86'/0'/0'/0/0");
    expect(wallet.receiveAddress.startsWith('nito1p')).toBe(true);
    expect(JSON.stringify(vault)).toBe(stored);
    await expect(decryptVault(vault, 'incorrect-test-password', 'invalid', crypto)).rejects.toThrow('invalid');
  }, 60_000);

  it('round-trips a vault through native entropy and the real 600000-round KDF', async () => {
    const vault = await encryptVault({ ...fixture.payload, version: 1 }, fixture.password, false, 'password', crypto);
    expect(vault.rounds).toBe(600_000);
    expect(Buffer.from(vault.salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(vault.nonce, 'base64')).toHaveLength(24);
    expect(await decryptVault(vault, fixture.password, 'invalid', crypto)).toEqual(fixture.payload);
  }, 60_000);

  it('returns entropy, BIP39 and PBKDF2 JSON compatible with JavaScript without exposing extra fields', async () => {
    const random = await crypto.randomBytes(32);
    expect(Object.keys(random)).toEqual(['bytesBase64']);
    expect(Buffer.from(random.bytesBase64, 'base64')).toHaveLength(32);
    for (const extra of [undefined, Buffer.alloc(32, 7).toString('base64')]) {
      const generated = await crypto.generateMnemonic(extra);
      expect(Object.keys(generated)).toEqual(['mnemonic']);
      expect(generated.mnemonic.split(' ')).toHaveLength(24);
      expect(validateMnemonic(generated.mnemonic, wordlist)).toBe(true);
    }
    const kdf = await crypto.pbkdf2({ password: fixture.password, saltBase64: 'AAECAw==', rounds: 1234, outputLength: 32 });
    expect(kdf).toEqual({ keyBase64: pbkdf2Sync(fixture.password, Buffer.from('AAECAw==', 'base64'), 1234, 32, 'sha256').toString('base64') });
    await expect(crypto.randomBytes(0)).rejects.toHaveProperty('code', 'INVALID_REQUEST');
  });

  it.each(HD_ACCOUNT_TEMPLATES)('signs and finalizes a $key multi-recipient send, acceleration and cancellation through Rust', async ({ key }) => {
    const f = await fundedWallet(key);
    const sign = vi.spyOn(crypto, 'signPsbt');
    const unsigned = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot: f.snapshot, crypto,
      changeAddress: f.change.address, outputs: [
        { address: f.destination.address, amountSats: 25_000_000n },
        { address: f.destination.address, amountSats: 5_000_000n },
      ] });
    expect(sign).not.toHaveBeenCalled();
    const sent = await signUnsignedTransparentTx({ mnemonic, transaction: unsigned, crypto });
    expect(sign).toHaveBeenCalledOnce();
    expect(Object.keys(await sign.mock.results[0]!.value)).toEqual(['psbtBase64']);
    sign.mockRestore();
    const tx = btc.Transaction.fromRaw(Buffer.from(sent.hex, 'hex'));
    expect(tx.id).toBe(sent.txid);
    expect(tx.getInput(0).sequence).toBe(RBF_SEQUENCE);
    expect(sent.walletOutputs.some((output) => output.address === f.change.address)).toBe(true);
    const lifecycle: TransactionLifecycleRecord = { lifecycleId: 'test-send', walletId: fixture.payload.address,
      purpose: 'send', state: 'published', txid: sent.txid, rawTxHex: sent.hex,
      address: f.change.address, derivationPath: f.change.path, addressIndex: 1,
      recoveryAttempts: 1, broadcastInvocations: 1, nextBroadcastAttemptAt: null, lastBroadcastAttemptAt: 0 };
    const reader = { getTransactionHex: async (id: string) => id === sent.txid ? sent.hex : f.rawParent,
      getAddressHistory: async (address: string) => [{ txid: sent.txid, height: 0, address }, { txid: f.parent.id, height: 10, address }] };
    const original = await loadRbfOriginal({ lifecycle, reader, snapshot: f.snapshot, height: 210 });
    for (const [offset, mode] of (['accelerate', 'cancel'] as const).entries()) {
      const next = await deriveHdAddress(mnemonic, 'taproot', 'internal', 2 + offset, crypto);
      const quote = await prepareRbfQuote({ mnemonic, original, mode, returnAddress: next.address, returnIndex: next.index, networkRate: 20n, crypto });
      const replacement = await signUnsignedTransparentTx({ mnemonic, transaction: quote.transaction, crypto });
      expect(() => assertSignedRbfFee(quote, replacement.hex, replacement.txid)).not.toThrow();
      expect(replacement.txid).not.toBe(sent.txid);
      expect(replacement.walletInputs).toEqual(sent.walletInputs);
      expect(replacement.feeSats).toBeGreaterThan(sent.feeSats);
      if (mode === 'cancel') {
        expect(replacement.outputCount).toBe(1);
        expect(replacement.walletOutputs[0]?.address).toBe(next.address);
      } else {
        const parsed = btc.Transaction.fromRaw(Buffer.from(replacement.hex, 'hex'));
        const amounts = Array.from({ length: parsed.outputsLength }, (_, index) => parsed.getOutput(index).amount);
        expect(amounts).toContain(25_000_000n);
        expect(amounts).toContain(5_000_000n);
      }
    }
  }, 60_000);

  it.each(HD_ACCOUNT_TEMPLATES)('signs and finalizes a $key consolidation to an internal Taproot address through Rust', async ({ key }) => {
    const f = await fundedWallet(key, 32);
    const plan = await prepareUnsignedTransparentConsolidation({ mnemonic, snapshot: f.snapshot,
      toAddresses: [f.change.address], crypto });
    expect(plan.transactions).toHaveLength(1);
    const transaction = plan.transactions[0]!;
    expect(transaction.inputCount).toBe(32);
    const signed = await signUnsignedTransparentTx({ mnemonic, transaction, crypto });
    const parsed = btc.Transaction.fromRaw(Buffer.from(signed.hex, 'hex'));
    expect(parsed.id).toBe(signed.txid);
    expect(parsed.inputsLength).toBe(32);
    expect(signed.walletOutputs.every((output) => output.address === f.change.address)).toBe(true);
    expect(signed.walletOutputs.reduce((sum, output) => sum + output.valueSats, signed.feeSats)).toBe(100_000_000);
  }, 60_000);

  it('signs one transaction with inputs from all four families using the native prevout checks', async () => {
    const wallets = await Promise.all(HD_ACCOUNT_TEMPLATES.map(({ key }) => fundedWallet(key)));
    const first = wallets[0]!;
    const snapshot = { ...first.snapshot, utxos: wallets.flatMap((wallet) => wallet.snapshot.utxos),
      addresses: wallets.map((wallet) => wallet.snapshot.addresses[0]!),
      confirmedSats: 400_000_000, balanceSats: 400_000_000, spendableSats: 400_000_000 };
    const plan = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot, crypto,
      changeAddress: first.change.address, outputs: [{ address: first.destination.address, amountSats: 350_000_000n }] });
    expect(plan.inputCount).toBe(4);
    const signed = await signUnsignedTransparentTx({ mnemonic, transaction: plan, crypto });
    expect(btc.Transaction.fromRaw(Buffer.from(signed.hex, 'hex')).inputsLength).toBe(4);
    const changed = { ...plan, signers: plan.signers.map((signer) => ({ ...signer, path: "m/86'/0'/0'/1/99" })) };
    await expect(signUnsignedTransparentTx({ mnemonic, transaction: changed, crypto })).rejects.toHaveProperty('code', 'INVALID_PSBT');
  }, 60_000);
});
