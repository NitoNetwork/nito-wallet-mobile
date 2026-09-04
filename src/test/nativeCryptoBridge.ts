/// <reference types="node" />

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createNitoWalletCryptoBridge } from '../native/nitoWalletCryptoContract';

const root = fileURLToPath(new URL('../../', import.meta.url));
const executable = fileURLToPath(new URL(
  `../../native/nito-wallet-crypto/target/debug/examples/contract_bridge${process.platform === 'win32' ? '.exe' : ''}`,
  import.meta.url,
));

export const buildNativeCryptoTestBridge = () => {
  // Build from current sources every run. A stale binary must never certify a fix.
  execFileSync('cargo', [
    'build', '--locked', '--example', 'contract_bridge',
    '--manifest-path', 'native/nito-wallet-crypto/Cargo.toml',
    '--target-dir', 'native/nito-wallet-crypto/target',
  ], { cwd: root, timeout: 180_000, stdio: 'pipe' });
};

export const invokeNativeCrypto = async (operation: string, request: string): Promise<string> => (
  execFileSync(executable, [], {
    cwd: root,
    input: JSON.stringify({ operation, request }),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  })
);

export const createNativeCryptoTestBridge = () => createNitoWalletCryptoBridge({
  invoke: invokeNativeCrypto,
});
