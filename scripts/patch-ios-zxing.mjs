import { chmod, readFile, writeFile } from 'node:fs/promises';

const sourcePath =
  process.env.NITO_ZXING_SOURCE ??
  'ios/Pods/ZXingObjC/ZXingObjC/oned/ZXUPCEANReader.m';
const replacements = [
  [
    'const int ZX_UPC_EAN_START_END_PATTERN[ZX_UPC_EAN_START_END_PATTERN_LEN]',
    'const int ZX_UPC_EAN_START_END_PATTERN[3]',
  ],
  [
    'const int ZX_UPC_EAN_MIDDLE_PATTERN[ZX_UPC_EAN_MIDDLE_PATTERN_LEN]',
    'const int ZX_UPC_EAN_MIDDLE_PATTERN[5]',
  ],
  [
    'const int ZX_UPC_EAN_L_PATTERNS[ZX_UPC_EAN_L_PATTERNS_LEN][ZX_UPC_EAN_L_PATTERNS_SUB_LEN]',
    'const int ZX_UPC_EAN_L_PATTERNS[10][4]',
  ],
  [
    'const int ZX_UPC_EAN_L_AND_G_PATTERNS[ZX_UPC_EAN_L_AND_G_PATTERNS_LEN][ZX_UPC_EAN_L_AND_G_PATTERNS_SUB_LEN]',
    'const int ZX_UPC_EAN_L_AND_G_PATTERNS[20][4]',
  ],
];

let source = await readFile(sourcePath, 'utf8');
let changed = false;

for (const [before, after] of replacements) {
  if (source.includes(before)) {
    source = source.replace(before, after);
    changed = true;
    continue;
  }

  if (!source.includes(after)) {
    throw new Error(`Unexpected ZXingObjC source: missing ${before}`);
  }
}

if (changed) {
  await chmod(sourcePath, 0o644);
  await writeFile(sourcePath, source, 'utf8');
}

console.log('ZXingObjC uses standard fixed-size array declarations.');
