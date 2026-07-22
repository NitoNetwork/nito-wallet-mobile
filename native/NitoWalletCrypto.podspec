Pod::Spec.new do |s|
  s.name = 'NitoWalletCrypto'
  s.version = '1.1.6'
  s.summary = 'Native Rust cryptographic core for Nito Wallet'
  s.homepage = 'https://nito.network'
  s.license = { :type => 'MIT' }
  s.author = { 'Nito Network' => 'help@nito.network' }
  s.source = { :git => 'https://github.com/NitoNetwork/nito-wallet-mobile.git', :tag => s.version.to_s }
  s.platform = :ios, '16.4'
  s.requires_arc = true
  s.source_files = 'ios/**/*.{h,m,mm}'
  s.public_header_files = 'ios/**/*.h'
  s.vendored_libraries = 'ios/lib/libnito_wallet_crypto.a'
  s.preserve_paths = 'ios/lib/libnito_wallet_crypto.a', 'nito-wallet-crypto/include/**/*.h'
  s.dependency 'React-Core'

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/nito-wallet-crypto/include"',
    'GCC_TREAT_WARNINGS_AS_ERRORS' => 'YES',
    'SWIFT_TREAT_WARNINGS_AS_ERRORS' => 'YES',
    'GCC_WARN_INHIBIT_ALL_WARNINGS' => 'NO',
    'SWIFT_SUPPRESS_WARNINGS' => 'NO'
  }
end
