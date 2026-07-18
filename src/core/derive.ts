import { HDKey } from '@scure/bip32';
import { bech32 } from 'bech32';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { NITO_DERIVATION_PATH, NITO_HRP } from '../constants/nito';

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

export function deriveBech32AddressFromSeed(seedHex: string, derivationPath = NITO_DERIVATION_PATH): string {
  const seed = hexToBytes(seedHex);
  const root = HDKey.fromMasterSeed(seed);
  const node = root.derive(derivationPath);
  const pubKey = node.publicKey;

  if (!pubKey || pubKey.length !== 33) {
    throw new Error('Internal error: invalid HD public key.');
  }

  const hash = hash160(pubKey);
  const words = bech32.toWords(Array.from(hash));
  return bech32.encode(NITO_HRP, [0, ...words]);
}
