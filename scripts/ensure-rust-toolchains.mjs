import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
const env = { ...process.env, PATH: `${cargoBin}${path.delimiter}${process.env.PATH ?? ''}` };
const platform = process.env.EAS_BUILD_PLATFORM;

const run = (command, args) => {
  const result = spawnSync(command, args, { env, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
};

run('cargo', ['--version']);

if (platform === 'android') {
  run('rustup', ['target', 'add', 'aarch64-linux-android', 'armv7-linux-androideabi', 'i686-linux-android', 'x86_64-linux-android']);
  const cargoNdk = spawnSync('cargo', ['ndk', '--version'], { env, stdio: 'ignore', shell: false });
  if (cargoNdk.status !== 0) {
    run('cargo', ['install', 'cargo-ndk', '--version', '4.1.2', '--locked']);
  }
}

if (platform === 'ios') {
  run('rustup', ['target', 'add', 'aarch64-apple-ios', 'aarch64-apple-ios-sim', 'x86_64-apple-ios']);
}
