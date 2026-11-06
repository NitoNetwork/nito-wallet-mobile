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
import { bindBip39Passphrase } from './nitoWalletCryptoContract';
import { deriveHdAddress, deriveHdPath, HD_ACCOUNT_TEMPLATES, type HdAccountKey } from '../wallet/hdAddress';
import { deriveLegacyCompatibleWallet, restoreLegacyCompatibleWallet } from '../wallet/walletIdentity';
import { NITO_SIGNER_NETWORK, RBF_SEQUENCE, changeAccountForRecipients, prepareUnsignedTransparentMultiSend, prepareUnsignedTransparentConsolidation, signUnsignedTransparentTx } from '../wallet/transparentSend';
import { loadRbfOriginal, prepareRbfQuote, assertSignedRbfFee } from '../wallet/transparentRbf';
import type { TransactionLifecycleRecord } from '../services/transactionLifecycle';
import type { ScannedAddress, TransparentWalletSnapshot } from '../wallet/transparentScan';

const mnemonic = fixture.payload.mnemonic;
const crypto = createNativeCryptoTestBridge();
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');

const fundedWallet = async (
  family: HdAccountKey,
  outputCount = 1,
  walletCrypto = crypto,
) => {
  const input = await deriveHdAddress(mnemonic, family, 'external', 0, walletCrypto);
  const change = await deriveHdAddress(mnemonic, 'taproot', 'internal', 1, walletCrypto);
  const destination = await deriveHdAddress(mnemonic, 'bech32', 'external', 5, walletCrypto);
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
    expect(payload).toEqual({ ...fixture.payload, bip39Passphrase: '' });
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
    expect(await decryptVault(vault, fixture.password, 'invalid', crypto)).toEqual({
      ...fixture.payload,
      bip39Passphrase: '',
    });
  }, 60_000);

  it('derives and signs with the same optional BIP39 passphrase in real Rust', async () => {
    const walletCrypto = bindBip39Passphrase(crypto, 'Nito recovery secret');
    const plain = await deriveHdAddress(mnemonic, 'taproot', 'external', 0, crypto);
    const protectedAddress = await deriveHdAddress(
      mnemonic,
      'taproot',
      'external',
      0,
      walletCrypto,
    );
    expect(protectedAddress.address).not.toBe(plain.address);

    const identity = await deriveLegacyCompatibleWallet(
      mnemonic,
      'Nito recovery secret',
      crypto,
    );
    const protectedVault = await encryptVault({
      version: 1,
      mnemonic,
      bip39Passphrase: identity.bip39Passphrase,
      address: identity.walletId,
      derivationPath: identity.walletIdDerivationPath,
      createdAt: '2026-11-06T00:00:00.000Z',
    }, fixture.password, false, 'password', crypto);
    const protectedPayload = await decryptVault(
      protectedVault,
      fixture.password,
      'invalid',
      crypto,
    );
    const restored = await restoreLegacyCompatibleWallet(
      protectedPayload,
      'taproot',
      0,
      crypto,
    );
    expect(restored.walletId).toBe(identity.walletId);
    expect(restored.receiveAddress).toBe(identity.receiveAddress);

    const funded = await fundedWallet('taproot', 1, walletCrypto);
    const unsigned = await prepareUnsignedTransparentMultiSend({
      mnemonic,
      snapshot: funded.snapshot,
      crypto: walletCrypto,
      changeAddress: funded.change.address,
      outputs: [{ address: funded.destination.address, amountSats: 50_000_000n }],
    });
    await expect(signUnsignedTransparentTx({
      mnemonic,
      transaction: unsigned,
      crypto: walletCrypto,
    })).resolves.toMatchObject({ inputCount: 1 });
    await expect(signUnsignedTransparentTx({
      mnemonic,
      transaction: unsigned,
      crypto,
    })).rejects.toThrow();
  }, 60_000);

  it('keeps the optional BIP39 passphrase through consolidation and RBF cancellation', async () => {
    const walletCrypto = bindBip39Passphrase(crypto, 'Nito recovery secret');
    const consolidatedWallet = await fundedWallet('taproot', 32, walletCrypto);
    const consolidation = await prepareUnsignedTransparentConsolidation({
      mnemonic,
      snapshot: consolidatedWallet.snapshot,
      toAddresses: [consolidatedWallet.change.address],
      crypto: walletCrypto,
    });
    const consolidated = await signUnsignedTransparentTx({
      mnemonic,
      transaction: consolidation.transactions[0]!,
      crypto: walletCrypto,
    });
    expect(consolidated.inputCount).toBe(32);

    const funded = await fundedWallet('taproot', 1, walletCrypto);
    const unsigned = await prepareUnsignedTransparentMultiSend({
      mnemonic,
      snapshot: funded.snapshot,
      changeAddress: funded.change.address,
      outputs: [{ address: funded.destination.address, amountSats: 10_000_000n }],
      crypto: walletCrypto,
    });
    const sent = await signUnsignedTransparentTx({
      mnemonic,
      transaction: unsigned,
      crypto: walletCrypto,
    });
    const lifecycle: TransactionLifecycleRecord = {
      lifecycleId: 'passphrase-rbf',
      walletId: 'passphrase-wallet',
      purpose: 'send',
      state: 'published',
      txid: sent.txid,
      rawTxHex: sent.hex,
      address: funded.change.address,
      derivationPath: funded.change.path,
      addressIndex: funded.change.index,
      recoveryAttempts: 1,
      broadcastInvocations: 1,
      nextBroadcastAttemptAt: null,
      lastBroadcastAttemptAt: 0,
    };
    const original = await loadRbfOriginal({
      lifecycle,
      snapshot: funded.snapshot,
      height: 210,
      reader: {
        getTransactionHex: async (id) => id === sent.txid ? sent.hex : funded.rawParent,
        getAddressHistory: async (address) => [
          { txid: sent.txid, height: 0, address },
          { txid: funded.parent.id, height: 10, address },
        ],
      },
    });
    const returnAddress = await deriveHdAddress(
      mnemonic,
      'taproot',
      'internal',
      2,
      walletCrypto,
    );
    const quote = await prepareRbfQuote({
      mnemonic,
      original,
      mode: 'cancel',
      returnAddress: returnAddress.address,
      returnIndex: returnAddress.index,
      networkRate: 20n,
      crypto: walletCrypto,
    });
    const cancelled = await signUnsignedTransparentTx({
      mnemonic,
      transaction: quote.transaction,
      crypto: walletCrypto,
    });
    expect(() => assertSignedRbfFee(quote, cancelled.hex, cancelled.txid)).not.toThrow();
    expect(cancelled.walletOutputs[0]?.address).toBe(returnAddress.address);
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

  it.each(HD_ACCOUNT_TEMPLATES)('signs and finalizes a passphrase-protected $key multi-recipient send, acceleration and cancellation through Rust', async ({ key }) => {
    const walletCrypto = bindBip39Passphrase(crypto, 'Nito recovery secret');
    const f = await fundedWallet(key, 1, walletCrypto);
    const sign = vi.spyOn(walletCrypto, 'signPsbt');
    const unsigned = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot: f.snapshot, crypto: walletCrypto,
      changeAddress: f.change.address, outputs: [
        { address: f.destination.address, amountSats: 25_000_000n },
        { address: f.destination.address, amountSats: 5_000_000n },
      ] });
    expect(sign).not.toHaveBeenCalled();
    const sent = await signUnsignedTransparentTx({ mnemonic, transaction: unsigned, crypto: walletCrypto });
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
      const next = await deriveHdAddress(mnemonic, 'taproot', 'internal', 2 + offset, walletCrypto);
      const quote = await prepareRbfQuote({ mnemonic, original, mode, returnAddress: next.address, returnIndex: next.index, networkRate: 20n, crypto: walletCrypto });
      const replacement = await signUnsignedTransparentTx({ mnemonic, transaction: quote.transaction, crypto: walletCrypto });
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

  it.each(HD_ACCOUNT_TEMPLATES)('signs automatic $key change, cancels the original and spends confirmed change using real Rust', async ({ key }) => {
    const f = await fundedWallet('taproot');
    const destination = await deriveHdAddress(mnemonic, key, 'external', 5, crypto);
    const family = changeAccountForRecipients([destination.address]);
    expect(family).toBe(key);
    const change = await deriveHdAddress(mnemonic, family, 'internal', 7, crypto);
    const unsigned = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot: f.snapshot, crypto,
      changeAddress: change.address, outputs: [{ address: destination.address, amountSats: 10_000_000n }] });
    const signed = await signUnsignedTransparentTx({ mnemonic, transaction: unsigned, crypto });
    const output = signed.walletOutputs.find((item) => item.address === change.address)!;
    expect(output).toBeDefined();
    const lifecycle: TransactionLifecycleRecord = { lifecycleId: `auto-${key}`, walletId: fixture.payload.address,
      purpose: 'send', state: 'published', txid: signed.txid, rawTxHex: signed.hex,
      address: change.address, derivationPath: change.path, addressIndex: change.index,
      recoveryAttempts: 1, broadcastInvocations: 1, nextBroadcastAttemptAt: null, lastBroadcastAttemptAt: 0 };
    const original = await loadRbfOriginal({ lifecycle, snapshot: f.snapshot, height: 210, reader: {
      getTransactionHex: async (id) => id === signed.txid ? signed.hex : f.rawParent,
      getAddressHistory: async (address) => [{ txid: signed.txid, height: 0, address }, { txid: f.parent.id, height: 10, address }],
    } });
    const quote = await prepareRbfQuote({ mnemonic, original, mode: 'cancel', returnAddress: f.change.address,
      returnIndex: f.change.index, networkRate: 20n, crypto });
    const cancelled = await signUnsignedTransparentTx({ mnemonic, transaction: quote.transaction, crypto });
    expect(() => assertSignedRbfFee(quote, cancelled.hex, cancelled.txid)).not.toThrow();
    expect(cancelled.walletInputs).toEqual(signed.walletInputs);
    expect(cancelled.walletOutputs).toHaveLength(1);
    expect(cancelled.walletOutputs[0]?.address).toBe(f.change.address);
    const scanned: ScannedAddress = { ...f.snapshot.addresses[0]!, ...change, accountLabel: key,
      accountPath: change.path.split('/').slice(0, 4).join('/') };
    const nextSnapshot: TransparentWalletSnapshot = { ...f.snapshot, addresses: [scanned],
      utxos: [{ txid: signed.txid, vout: output.vout, valueSats: output.valueSats,
        address: change.address, height: 211, confirmations: 1, isCoinbase: false, rawTx: signed.hex }] };
    const spending = await prepareUnsignedTransparentMultiSend({ mnemonic, snapshot: nextSnapshot, crypto,
      changeAddress: f.change.address, outputs: [{ address: destination.address, amountSats: 1_000_000n }] });
    const spent = await signUnsignedTransparentTx({ mnemonic, transaction: spending, crypto });
    expect(spent.walletInputs[0]?.address).toBe(change.address);
    expect(btc.Transaction.fromRaw(Buffer.from(spent.hex, 'hex')).id).toBe(spent.txid);
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
