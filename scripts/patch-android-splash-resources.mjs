import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const basePath =
  process.env.NITO_ANDROID_STYLES ??
  'android/app/src/main/res/values/styles.xml';
const v33Path =
  process.env.NITO_ANDROID_STYLES_V33 ??
  'android/app/src/main/res/values-v33/styles.xml';
const behaviorItem =
  '<item name="android:windowSplashScreenBehavior">icon_preferred</item>';
const stringsPath = 'android/app/src/main/res/values/strings.xml';
const unusedLauncherBackground =
  'android/app/src/main/res/drawable/ic_launcher_background.xml';

let baseStyles = await readFile(basePath, 'utf8');
baseStyles = baseStyles.replace(
  /^\s*<item name="android:windowSplashScreenBehavior">icon_preferred<\/item>\r?\n?/gm,
  '',
);

const splashMatch = baseStyles.match(
  /\s*<style name="Theme\.App\.SplashScreen"[\s\S]*?<\/style>/,
);
if (!splashMatch) {
  throw new Error('Theme.App.SplashScreen is missing from Android styles.');
}

const splashStyle = splashMatch[0]
  .trimStart()
  .replace(/\s*<\/style>$/, `\n    ${behaviorItem}\n  </style>`);

let v33Styles;
try {
  v33Styles = await readFile(v33Path, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') {
    throw error;
  }
  v33Styles = '<resources>\n</resources>\n';
}

const existingSplash = /\s*<style name="Theme\.App\.SplashScreen"[\s\S]*?<\/style>/;
if (existingSplash.test(v33Styles)) {
  v33Styles = v33Styles.replace(existingSplash, `\n  ${splashStyle}`);
} else {
  v33Styles = v33Styles.replace('</resources>', `  ${splashStyle}\n</resources>`);
}

await mkdir(path.dirname(v33Path), { recursive: true });
await writeFile(basePath, baseStyles, 'utf8');
await writeFile(v33Path, v33Styles, 'utf8');

let strings = await readFile(stringsPath, 'utf8');
strings = strings.replace(
  /^\s*<string name="expo_splash_screen_resize_mode"[^>]*>.*<\/string>\r?\n?/gm,
  '',
);
await writeFile(stringsPath, strings, 'utf8');

await rm(unusedLauncherBackground, { force: true });

console.log('Android splash resources are normalized and lint-clean.');
