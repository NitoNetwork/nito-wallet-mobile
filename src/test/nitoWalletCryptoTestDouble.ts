/// <reference types="node" />

import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as btc from '@scure/btc-signer';
import { pubSchnorr } from '@scure/btc-signer/utils.js';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { randomBytes as nodeRandomBytes } from 'node:crypto';

import type {
  NativeAddressRequest,
  NativeDerivedAddress,
  NitoWalletCryptoApi,
} from '../native/nitoWalletCryptoContract';

const NETWORK = {
  bech32: 'nito', pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80,
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
};
const bytesToHex = (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytesToBase64 = (value: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const derive = (
  mnemonic: string,
  request: NativeAddressRequest,
  bip39Passphrase = '',
): NativeDerivedAddress => {
  const child = HDKey.fromMasterSeed(
    mnemonicToSeedSync(mnemonic, bip39Passphrase.normalize('NFKD')),
  ).derive(request.path);
  if (!child.publicKey || !child.privateKey) throw new Error('Test HD derivation failed.');
  let payment;
  let redeemScriptHex: string | undefined;
  let tapInternalKeyHex: string | undefined;
  if (request.scriptType === 'p2pkh') payment = btc.p2pkh(child.publicKey, NETWORK);
  else if (request.scriptType === 'p2sh-p2wpkh') {
    const inner = btc.p2wpkh(child.publicKey, NETWORK);
    payment = btc.p2sh(inner, NETWORK);
    redeemScriptHex = inner.script ? bytesToHex(inner.script) : undefined;
  } else if (request.scriptType === 'p2tr') {
    const internalKey = pubSchnorr(child.privateKey);
    payment = btc.p2tr(internalKey, undefined, NETWORK);
    tapInternalKeyHex = bytesToHex(internalKey);
  } else payment = btc.p2wpkh(child.publicKey, NETWORK);
  if (!payment.address || !payment.script) throw new Error('Test payment derivation failed.');
  return {
    ...request,
    address: payment.address,
    publicKeyHex: bytesToHex(child.publicKey),
    scriptHex: bytesToHex(payment.script),
    redeemScriptHex,
    tapInternalKeyHex,
  };
};

export const createNitoWalletCryptoTestDouble = (): NitoWalletCryptoApi => ({
  isAvailable: () => true,
  async randomBytes(length) {
    return { bytesBase64: bytesToBase64(nodeRandomBytes(length)) };
  },
  async generateMnemonic(additionalEntropyBase64) {
    const additionalEntropy = additionalEntropyBase64
      ? base64ToBytes(additionalEntropyBase64)
      : new Uint8Array(32);
    if (additionalEntropy.length !== 32) {
      throw new Error('Test additional entropy must contain 32 bytes.');
    }
    const systemEntropy = nodeRandomBytes(32);
    const entropy = Uint8Array.from(
      systemEntropy,
      (byte, index) => byte ^ additionalEntropy[index]!,
    );
    systemEntropy.fill(0);
    additionalEntropy.fill(0);
    const mnemonic = entropyToMnemonic(entropy, wordlist);
    entropy.fill(0);
    return { mnemonic };
  },
  async pbkdf2({ password, saltBase64, rounds, outputLength }) {
    const key = await pbkdf2Async(sha256, new TextEncoder().encode(password), base64ToBytes(saltBase64), {
      c: rounds,
      dkLen: outputLength,
    });
    return { keyBase64: bytesToBase64(key) };
  },
  async deriveAddresses(mnemonic, requests, bip39Passphrase = '') {
    return requests.map((request) => derive(mnemonic, request, bip39Passphrase));
  },
  async signPsbt({ mnemonic, bip39Passphrase = '', psbtBase64, signers }) {
    const transaction = btc.Transaction.fromPSBT(base64ToBytes(psbtBase64));
    const root = HDKey.fromMasterSeed(
      mnemonicToSeedSync(mnemonic, bip39Passphrase.normalize('NFKD')),
    );
    for (const path of new Set(signers.map((signer) => signer.path))) {
      const privateKey = root.derive(path).privateKey;
      if (!privateKey) throw new Error(`Test signing key unavailable for ${path}.`);
      transaction.sign(privateKey);
    }
    return { psbtBase64: bytesToBase64(transaction.toPSBT(0)) };
  },
});
