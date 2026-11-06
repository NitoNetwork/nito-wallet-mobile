import { readFileSync } from 'node:fs';

const forbiddenPermissions = [
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

function findForbiddenPermissions(manifestSource) {
  return forbiddenPermissions.filter(
    (permission) =>
      manifestSource.includes(`android:name="${permission}"`) ||
      manifestSource.includes(`android:name='${permission}'`),
  );
}

if (process.argv[2] === '--self-test') {
  const clean = '<uses-permission android:name="android.permission.INTERNET" />';
  const forbidden =
    '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />';
  if (
    findForbiddenPermissions(clean).length !== 0 ||
    findForbiddenPermissions(forbidden).join() !==
      'android.permission.WRITE_EXTERNAL_STORAGE'
  ) {
    throw new Error('Android permission gate self-test failed.');
  }
  console.log('Android permission gate self-test passed.');
  process.exit(0);
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  throw new Error('Pass the merged Android manifest path.');
}

const findings = findForbiddenPermissions(readFileSync(manifestPath, 'utf8'));
if (findings.length !== 0) {
  throw new Error(`Forbidden Android permissions found: ${findings.join(', ')}`);
}

console.log(`${manifestPath}: no forbidden Android permission found.`);
