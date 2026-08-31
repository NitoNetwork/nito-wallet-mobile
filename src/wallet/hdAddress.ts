import { nitoWalletCrypto } from '../native/nitoWalletCrypto';
import type {
  NitoWalletCryptoApi,
  TransparentScriptType,
} from '../native/nitoWalletCryptoContract';

export type HdBranch = 'external' | 'internal';
export type HdAccountKey = 'legacy' | 'nested' | 'bech32' | 'taproot';

export type HdAccountTemplate = Readonly<{
  key: HdAccountKey;
  label: string;
  accountPath: string;
  scriptType: TransparentScriptType;
}>;

export type HdAddressSequence = Readonly<{
  accountKey: HdAccountKey;
  branch: HdBranch;
}>;

export type HdScanRequirement = HdAddressSequence & Readonly<{
  highestIssuedIndex: number;
}>;

export type IssuedHdAddress = HdAddressSequence & Readonly<{
  index: number;
  path: string;
  address: string;
  scriptType: TransparentScriptType;
}>;

export type KnownHdAddress = HdAddressSequence & Readonly<{
  index: number;
  used: boolean;
}>;

export const DEFAULT_HD_GAP_LIMIT = 20;
export const DEFAULT_RECEIVE_ACCOUNT_KEY: HdAccountKey = 'taproot';

export const HD_ACCOUNT_TEMPLATES: readonly HdAccountTemplate[] = [
  { key: 'legacy', label: 'Legacy', accountPath: "m/44'/0'/0'", scriptType: 'p2pkh' },
  { key: 'nested', label: 'P2SH', accountPath: "m/49'/0'/0'", scriptType: 'p2sh-p2wpkh' },
  { key: 'bech32', label: 'Bech32', accountPath: "m/84'/0'/0'", scriptType: 'p2wpkh' },
  { key: 'taproot', label: 'Taproot', accountPath: "m/86'/0'/0'", scriptType: 'p2tr' },
] as const;

export const hdAccountTemplate = (accountKey: HdAccountKey): HdAccountTemplate => {
  const template = HD_ACCOUNT_TEMPLATES.find((candidate) => candidate.key === accountKey);
  if (!template) throw new Error('Unsupported HD address family.');
  return template;
};

export const deriveHdPath = (
  accountKey: HdAccountKey,
  branch: HdBranch,
  index: number,
): string => {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error('Invalid HD address index.');
  }
  return `${hdAccountTemplate(accountKey).accountPath}/${branch === 'external' ? 0 : 1}/${index}`;
};

export const deriveHdAddress = async (
  mnemonic: string,
  accountKey: HdAccountKey,
  branch: HdBranch,
  index: number,
  crypto: NitoWalletCryptoApi = nitoWalletCrypto,
): Promise<IssuedHdAddress> => {
  const template = hdAccountTemplate(accountKey);
  const path = deriveHdPath(accountKey, branch, index);
  const [derived] = await crypto.deriveAddresses(mnemonic, [{
    path,
    scriptType: template.scriptType,
  }]);
  if (
    !derived
    || derived.path !== path
    || derived.scriptType !== template.scriptType
    || derived.address.trim() === ''
  ) {
    throw new Error('HD address derivation returned an inconsistent result.');
  }
  return {
    accountKey,
    branch,
    index,
    path,
    address: derived.address,
    scriptType: template.scriptType,
  };
};

export const highestUsedHdIndex = (
  addresses: readonly KnownHdAddress[],
  sequence: HdAddressSequence,
): number => addresses.reduce((highest, address) => (
  address.accountKey === sequence.accountKey
  && address.branch === sequence.branch
  && address.used
    ? Math.max(highest, address.index)
    : highest
), -1);

export const assertGapSafeIssuedIndex = ({
  addresses,
  sequence,
  index,
  gapLimit = DEFAULT_HD_GAP_LIMIT,
}: {
  addresses: readonly KnownHdAddress[];
  sequence: HdAddressSequence;
  index: number;
  gapLimit?: number;
}): void => {
  const highestUsed = highestUsedHdIndex(addresses, sequence);
  const highestRecoverable = highestUsed + gapLimit;
  if (index > highestRecoverable) {
    throw new Error('HD_ADDRESS_GAP_LIMIT_REACHED');
  }
};
