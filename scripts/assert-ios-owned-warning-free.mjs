import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const logPath = process.argv[2];
const warningPattern = /\bwarning:/i;
const categories = [
  {
    name: 'dependency source',
    pattern: /(?:\/node_modules\/|\/ios\/Pods\/)/,
  },
  {
    name: 'Apple toolchain',
    pattern: /(?:\/Applications\/Xcode[^/]*\.app\/|\/Library\/Developer\/CommandLineTools\/|appintentsmetadataprocessor.*warning: Metadata extraction skipped|search path '\/var\/run\/com\.apple\.security\.cryptexd\/.*\/Metal\.xctoolchain\/usr\/lib\/swift\/iphoneos' not found)/i,
  },
  {
    name: 'React Native archive',
    pattern: /libtool: warning: '[^']+\.o' has no symbols/i,
  },
  {
    name: 'generated JavaScript bundle',
    pattern: /\/main\.jsbundle:\d+:\d+: warning:/i,
  },
  {
    name: 'dependency build phase',
    pattern: /warning: Run script build phase .*\(in target .* from project 'Pods'\)/i,
  },
  {
    name: 'known dependency continuation',
    pattern: /warning: (?:pointer is missing a nullability type specifier|block pointer is missing a nullability type specifier|cannot find protocol (?:declaration|definition) for 'RCTHostDelegate'|'RCTRootView' is deprecated|implicit conversion loses integer precision: '(?:int64_t|i64)' \(aka 'long long'\) to 'int')/i,
  },
];

function classifyWarning(line) {
  if (!warningPattern.test(line)) return null;
  return categories.find(({ pattern }) => pattern.test(line))?.name ?? 'Nito project or unknown';
}

function runSelfTest() {
  const cases = [
    ['/repo/node_modules/react-native/Foo.mm:1: warning: upstream', 'dependency source'],
    ["libtool: warning: '/tmp/ReactNative/Foo.o' has no symbols", 'React Native archive'],
    ['/repo/ios/main.jsbundle:1:2: warning: standard global', 'generated JavaScript bundle'],
    ["warning: Run script build phase '[CP-User] Hermes' will be run during every build (in target 'hermes-engine' from project 'Pods')", 'dependency build phase'],
    ["warning: cannot find protocol definition for 'RCTHostDelegate'", 'known dependency continuation'],
    ["warning: implicit conversion loses integer precision: 'i64' (aka 'long long') to 'int'", 'known dependency continuation'],
    ["/repo/ios/NitoWallet.xcodeproj: warning: search path '/var/run/com.apple.security.cryptexd/mnt/com.apple.MobileAsset.MetalToolchain-v1/Metal.xctoolchain/usr/lib/swift/iphoneos' not found", 'Apple toolchain'],
    ['/repo/src/wallet.ts:12: warning: unsafe operation', 'Nito project or unknown'],
    ["/repo/ios/NitoWallet.xcodeproj: warning: ignoring duplicate libraries: '-lc++'", 'Nito project or unknown'],
    ['warning: an unrecognized diagnostic must fail closed', 'Nito project or unknown'],
  ];

  for (const [line, expected] of cases) {
    const actual = classifyWarning(line);
    if (actual !== expected) {
      throw new Error(`iOS warning classifier self-test failed: expected "${expected}", got "${actual}" for: ${line}`);
    }
  }

  console.log(`iOS warning classifier self-test passed (${cases.length} cases).`);
}

if (logPath === '--self-test') {
  runSelfTest();
  process.exit(0);
}

if (!logPath) {
  throw new Error('Usage: node scripts/assert-ios-owned-warning-free.mjs <xcode-log> | --self-test');
}

const lines = readFileSync(logPath, 'utf8').split(/\r?\n/);
const warnings = lines.filter((line) => warningPattern.test(line));
const classified = warnings.map((line) => ({ line, category: classifyWarning(line) }));
const ownedWarnings = classified.filter(({ category }) => category === 'Nito project or unknown');

if (ownedWarnings.length > 0) {
  console.error(`Project warning gate failed for ${basename(logPath)} (${ownedWarnings.length} owned or unknown warning(s)):`);
  for (const { line } of ownedWarnings) console.error(line);
  process.exit(1);
}

if (warnings.length === 0) {
  console.log(`No warnings found in ${basename(logPath)}.`);
  process.exit(0);
}

const counts = new Map();
for (const { category } of classified) {
  counts.set(category, (counts.get(category) ?? 0) + 1);
}

console.log(`Audited ${warnings.length} upstream/toolchain warning(s); no Nito project warnings found.`);
for (const [category, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`- ${category}: ${count}`);
}
