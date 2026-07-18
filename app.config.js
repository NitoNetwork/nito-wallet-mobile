export default {
  expo: {
    name: "Nito Wallet",
    slug: "nito-wallet",
    version: "1.1.3",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: "./assets/icon.png",
    ios: {
      supportsTablet: true,
      bundleIdentifier: process.env.NITO_IOS_BUNDLE_IDENTIFIER ?? "network.nito.wallet",
      buildNumber: "10104",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSFaceIDUsageDescription:
          "Nito Wallet uses Face ID to protect access to your wallet.",
      },
    },
    android: {
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
      ],
      package: process.env.NITO_ANDROID_PACKAGE ?? "network.nito.wallet",
      versionCode: 10104,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#020611",
      },
    },
    web: {
      bundler: "metro",
      favicon: "./assets/icon.png",
    },
    plugins: [
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
