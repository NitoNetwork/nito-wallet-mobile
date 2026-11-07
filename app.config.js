import { releaseBuildCode, releaseVersion } from "./scripts/release-version.mjs";

export default {
  expo: {
    name: "Nito Wallet",
    slug: "nito-wallet",
    version: releaseVersion,
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: "./assets/icon.png",
    ios: {
      supportsTablet: true,
      bundleIdentifier: process.env.NITO_IOS_BUNDLE_IDENTIFIER ?? "network.nito.wallet",
      buildNumber: String(releaseBuildCode),
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSFaceIDUsageDescription:
          "Nito Wallet uses Face ID to protect access to your wallet.",
      },
    },
    android: {
      package: process.env.NITO_ANDROID_PACKAGE ?? "network.nito.wallet",
      versionCode: releaseBuildCode,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
    },
    web: {
      bundler: "metro",
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-asset",
      [
        "expo-font",
        {
          android: {
            fonts: [
              {
                fontFamily: "SpaceGrotesk-Regular",
                fontDefinitions: [
                  { path: "./assets/fonts/SpaceGrotesk-Regular.ttf", weight: 400 },
                ],
              },
              {
                fontFamily: "SpaceGrotesk-Medium",
                fontDefinitions: [
                  { path: "./assets/fonts/SpaceGrotesk-Medium.ttf", weight: 500 },
                ],
              },
              {
                fontFamily: "SpaceGrotesk-SemiBold",
                fontDefinitions: [
                  { path: "./assets/fonts/SpaceGrotesk-SemiBold.ttf", weight: 600 },
                ],
              },
              {
                fontFamily: "SpaceGrotesk-Bold",
                fontDefinitions: [
                  { path: "./assets/fonts/SpaceGrotesk-Bold.ttf", weight: 700 },
                ],
              },
            ],
          },
          ios: {
            fonts: [
              "./assets/fonts/SpaceGrotesk-Regular.ttf",
              "./assets/fonts/SpaceGrotesk-Medium.ttf",
              "./assets/fonts/SpaceGrotesk-SemiBold.ttf",
              "./assets/fonts/SpaceGrotesk-Bold.ttf",
            ],
          },
        },
      ],
      "./plugins/withNitoWalletCrypto.cjs",
      "./plugins/withNitoAndroidBuildPolicy.cjs",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#020611",
          image: "./assets/splash-icon.png",
          imageWidth: 192,
          resizeMode: "contain",
          dark: {
            backgroundColor: "#020611",
            image: "./assets/splash-icon.png",
          },
        },
      ],
      "expo-sqlite",
      [
        "expo-camera",
        {
          cameraPermission: "Nito Wallet uses the camera only to scan Nito payment QR codes.",
          recordAudioAndroid: false,
          barcodeScannerEnabled: true,
        },
      ],
      [
        "expo-local-authentication",
        {
          faceIDPermission:
            "Nito Wallet uses Face ID to protect access to your wallet.",
        },
      ],
      [
        "expo-secure-store",
        {
          configureAndroidBackup: true,
          faceIDPermission:
            "Nito Wallet uses Face ID to protect access to your wallet.",
        },
      ],
      "expo-sharing",
      "./plugins/withNitoAndroidLintFixes.cjs",
    ],
    extra: {},
  },
};
