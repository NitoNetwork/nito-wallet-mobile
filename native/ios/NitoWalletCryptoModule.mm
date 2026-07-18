#import "NitoWalletCryptoModule.h"
#import "nito_wallet_crypto.h"

@implementation NitoWalletCryptoModule

RCT_EXPORT_MODULE(NitoWalletCrypto)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_REMAP_METHOD(invoke,
                 invokeOperation:(NSString *)operation
                 requestJson:(NSString *)requestJson
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    char *rawResult = nito_wallet_crypto_invoke(operation.UTF8String, requestJson.UTF8String);
    if (rawResult == NULL) {
      reject(@"NITO_RUST_FFI_ERROR", @"The native Rust core returned no result.", nil);
      return;
    }
    NSString *result = [NSString stringWithUTF8String:rawResult];
    nito_wallet_crypto_free(rawResult);
    if (result == nil) {
      reject(@"NITO_RUST_UTF8_ERROR", @"The native Rust core returned invalid UTF-8.", nil);
      return;
    }
    resolve(result);
  });
}

@end
