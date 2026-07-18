const {
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');

module.exports = function withNitoWalletCrypto(config) {
  let nextConfig = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfile = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      const current = await fs.readFile(podfile, 'utf8');
      const sourceBuildConfiguration = [
        "ENV['RCT_USE_RN_DEP'] = '0'",
        "ENV['RCT_USE_PREBUILT_RNCORE'] = '0'",
        "ENV['RCT_BUILD_HERMES_FROM_SOURCE'] = 'true'",
      ].join('\n');
      const declaration = "  pod 'NitoWalletCrypto', :path => '../native'\n";
      let next = current;
      if (!next.includes("ENV['RCT_USE_RN_DEP']")) {
        next = `${sourceBuildConfiguration}\n\n${next}`;
      }
      if (!next.includes("pod 'NitoWalletCrypto'")) {
        next = next.replace(/(\s+use_expo_modules!\s*\n)/, `$1${declaration}`);
        if (next === current) {
          throw new Error('Unable to add NitoWalletCrypto to the generated iOS Podfile.');
        }
      }
      if (next !== current) await fs.writeFile(podfile, next, 'utf8');
      return modConfig;
    },
  ]);

  nextConfig = withMainApplication(nextConfig, (modConfig) => {
    let contents = modConfig.modResults.contents;
    const importLine = 'import network.nito.wallet.nativecore.NitoWalletCorePackage';

    if (!contents.includes(importLine)) {
      contents = contents.replace(/^(package\s+[^\n]+\n)/m, `$1\n${importLine}\n`);
    }

    if (!contents.includes('add(NitoWalletCorePackage())')) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        (match) => `${match}\n          add(NitoWalletCorePackage())`,
      );
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  nextConfig = withAppBuildGradle(nextConfig, (modConfig) => {
    if (!modConfig.modResults.contents.includes('tasks.register("buildNitoRustCrypto"')) {
      modConfig.modResults.contents += `

def nitoRustCryptoDir = rootProject.file("../native/nito-wallet-crypto")
def nitoRustJniOutput = file("src/main/jniLibs")

tasks.register("buildNitoRustCrypto", Exec) {
    group = "build"
    description = "Builds the Nito Wallet Rust cryptographic core for Android."
    workingDir nitoRustCryptoDir
    inputs.files(fileTree(nitoRustCryptoDir) {
        include "Cargo.toml", "Cargo.lock", "src/**/*.rs"
    })
    outputs.dir nitoRustJniOutput
    commandLine "cargo", "ndk",
        "--platform", "24",
        "-t", "armeabi-v7a",
        "-t", "arm64-v8a",
        "-t", "x86",
        "-t", "x86_64",
        "-o", nitoRustJniOutput.absolutePath,
        "build", "--release", "--locked"
}

tasks.named("preBuild").configure {
    dependsOn("buildNitoRustCrypto")
}
`;
    }
    return modConfig;
  });

  nextConfig = withDangerousMod(nextConfig, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const androidRoot = modConfig.modRequest.platformProjectRoot;
      const sourceRoot = path.join(projectRoot, 'native', 'android');
      const targetRoot = path.join(
        androidRoot,
        'app',
        'src',
        'main',
        'java',
        'network',
        'nito',
        'wallet',
        'nativecore',
      );

      await fs.mkdir(targetRoot, { recursive: true });
      for (const file of [
        'NitoWalletCryptoModule.kt',
        'NitoWalletCorePackage.kt',
      ]) {
        await fs.copyFile(path.join(sourceRoot, file), path.join(targetRoot, file));
      }

      const drawableRoot = path.join(androidRoot, 'app', 'src', 'main', 'res');
      const splashBackupRoot = path.join(projectRoot, 'assets', 'android-splash');
      for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
        const source = path.join(splashBackupRoot, `drawable-${density}.png`);
        const targetDir = path.join(drawableRoot, `drawable-${density}`);
        if (existsSync(source)) {
          await fs.mkdir(targetDir, { recursive: true });
          await fs.copyFile(source, path.join(targetDir, 'splashscreen_logo.png'));
        }
      }

      return modConfig;
    },
  ]);

  return nextConfig;
};
