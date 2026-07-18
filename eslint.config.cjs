const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  globalIgnores([
    'android/**',
    'ios/**',
    'dist/**',
    'native/nito-wallet-crypto/target/**',
  ]),
  expoConfig,
  {
    files: [
      'app.config.js',
      '*.config.cjs',
      'plugins/**/*.{js,cjs}',
      'scripts/**/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
