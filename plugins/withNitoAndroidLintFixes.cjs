const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');

const GRADLE_VERSION = '8.14.5';
const FRESCO_VERSION = '3.7.0';

function withCleanManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const permissions = manifest['uses-permission'] || [];
    const blockedPermissions = new Set([
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ]);
    manifest['uses-permission'] = permissions.filter(
      (permission) => !blockedPermissions.has(permission.$?.['android:name'])
    );

    const features = manifest['uses-feature'] || [];
    if (!features.some((feature) => feature.$?.['android:name'] === 'android.hardware.camera')) {
      features.push({
        $: {
          'android:name': 'android.hardware.camera',
          'android:required': 'false',
        },
      });
    }
    manifest['uses-feature'] = features;

    const application = manifest.application?.[0];
    if (!application) {
      throw new Error('Generated Android manifest has no application element');
    }
    delete application.$['android:enableOnBackInvokedCallback'];

    const metadata = (application['meta-data'] || []).filter(
      (entry) => entry.$?.['android:name'] !== 'com.facebook.soloader.enabled'
    );
    metadata.push({
      $: {
        'android:name': 'com.facebook.soloader.enabled',
        'android:value': 'true',
        'tools:replace': 'android:value',
      },
    });
    application['meta-data'] = metadata;

    for (const provider of application.provider || []) {
      if (provider.$?.['android:name'] === 'expo.modules.filesystem.FileSystemFileProvider') {
        delete provider.$['tools:replace'];
      }
    }

    const activity = application.activity?.find((candidate) =>
      candidate['intent-filter']?.some((filter) =>
        filter.category?.some(
          (category) => category.$?.['android:name'] === 'android.intent.category.LAUNCHER'
        )
      )
    ) || application.activity?.[0];
    if (!activity) {
      throw new Error('Generated Android manifest has no launcher activity');
    }
    delete activity.$['android:screenOrientation'];
    return modConfig;
  });
}

function replaceText(filePath, transform) {
  const current = fs.readFileSync(filePath, 'utf8');
  const next = transform(current);
  if (next === current) {
    throw new Error(`Expected native build update was not applied: ${filePath}`);
  }
  fs.writeFileSync(filePath, next, 'utf8');
}

function modernizeGeneratedResources(androidRoot) {
  const mainRes = path.join(androidRoot, 'app', 'src', 'main', 'res');
  const editTextDrawable = path.join(mainRes, 'drawable', 'rn_edit_text_material.xml');
  fs.writeFileSync(
    editTextDrawable,
    `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:insetLeft="4dp"
    android:insetTop="4dp"
    android:insetRight="4dp"
    android:insetBottom="4dp">
  <selector>
    <item android:state_enabled="false">
      <shape android:shape="rectangle">
        <solid android:color="@android:color/transparent" />
        <stroke android:width="1dp" android:color="#5C6370" />
      </shape>
    </item>
    <item android:state_focused="true">
      <shape android:shape="rectangle">
        <solid android:color="@android:color/transparent" />
        <stroke android:width="2dp" android:color="#2F80ED" />
      </shape>
    </item>
    <item>
      <shape android:shape="rectangle">
        <solid android:color="@android:color/transparent" />
        <stroke android:width="1dp" android:color="#8A94A6" />
      </shape>
    </item>
  </selector>
</inset>
`,
    'utf8'
  );

  const colorsPath = path.join(mainRes, 'values', 'colors.xml');
  replaceText(colorsPath, (contents) =>
    contents.replace(/^\s*<color name="splashscreen_background">[^<]*<\/color>\r?\n/m, '')
  );

  const unusedLauncherBackground = path.join(mainRes, 'drawable', 'ic_launcher_background.xml');
  if (fs.existsSync(unusedLauncherBackground)) {
    fs.unlinkSync(unusedLauncherBackground);
  }

  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    const mipmapDir = path.join(mainRes, `mipmap-${density}`);
    for (const name of ['ic_launcher', 'ic_launcher_foreground', 'ic_launcher_round']) {
      const source = path.join(mipmapDir, `${name}.webp`);
      const destination = path.join(mipmapDir, `${name}.png`);
      if (fs.existsSync(source)) {
        fs.renameSync(source, destination);
      }
    }
  }

  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const iconPath = path.join(mainRes, 'mipmap-anydpi-v26', name);
    replaceText(iconPath, (contents) =>
      contents.replace(
        '</adaptive-icon>',
        '    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>'
      )
    );
  }

  const rawDir = path.join(mainRes, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(
    path.join(rawDir, 'nito_resource_keep.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@integer/react_native_dev_server_port,@string/react_native_dev_server_ip,@string/expo_system_ui_user_interface_style" />
`,
    'utf8'
  );
}

function withGeneratedAndroidFixes(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const androidRoot = modConfig.modRequest.platformProjectRoot;
      const wrapper = path.join(androidRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
      replaceText(wrapper, (contents) =>
        contents.replace(/gradle-[0-9.]+-bin\.zip/g, `gradle-${GRADLE_VERSION}-bin.zip`)
      );

      const appGradle = path.join(androidRoot, 'app', 'build.gradle');
      replaceText(appGradle, (contents) =>
        contents
          .replace(
            'com.facebook.fresco:animated-gif:${expoLibs.versions.fresco.get()}',
            `com.facebook.fresco:animated-gif:${FRESCO_VERSION}`
          )
          .replace(
            'com.facebook.fresco:webpsupport:${expoLibs.versions.fresco.get()}',
            `com.facebook.fresco:webpsupport:${FRESCO_VERSION}`
          )
      );

      modernizeGeneratedResources(androidRoot);
      return modConfig;
    },
  ]);
}

module.exports = function withNitoAndroidLintFixes(config) {
  config = withCleanManifest(config);
  config = withGeneratedAndroidFixes(config);
  return config;
};
