import { spawn } from "node:child_process";

const bundleIdentifier =
  process.env.NITO_IOS_BUNDLE_IDENTIFIER ?? "network.nito.wallet.free";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["expo", "prebuild", "--platform", "ios", "--clean"];

const child = spawn(command, args, {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    NITO_IOS_BUNDLE_IDENTIFIER: bundleIdentifier,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Expo prebuild stopped with signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});