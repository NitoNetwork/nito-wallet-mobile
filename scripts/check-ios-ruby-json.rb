require 'cocoapods'
require 'active_support/json'
require 'active_support/core_ext/object/json'

# Expo autolinking serializes its sandbox metadata through ActiveSupport.
# Exercise that path before pod install, including the obsolete option it uses.
payload = { 'modules' => [{ 'name' => 'NitoWalletCrypto', 'enabled' => true }] }
raise 'ActiveSupport JSON round trip failed' unless JSON.parse(payload.to_json) == payload
raise 'CocoaPods JSON compatibility failed' unless JSON.parse(JSON.generate(payload, quirks_mode: true)) == payload

puts "CocoaPods #{Pod::VERSION}, ActiveSupport #{ActiveSupport::VERSION::STRING}, JSON #{JSON::VERSION}: serialization passed."
