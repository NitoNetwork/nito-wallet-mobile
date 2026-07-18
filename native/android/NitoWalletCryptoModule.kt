package network.nito.wallet.nativecore

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

class NitoWalletCryptoModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  private external fun nativeInvoke(operation: String, requestJson: String): String?

  @ReactMethod
  fun invoke(operation: String, requestJson: String, promise: Promise) {
    if (!rustLinked) {
      promise.reject("NITO_WALLET_CRYPTO_UNAVAILABLE", "The native Nito Wallet Rust core is not linked.")
      return
    }
    executor.execute {
      try {
        val result = nativeInvoke(operation, requestJson)
        if (result == null) {
          promise.reject("NITO_RUST_FFI_ERROR", "The native Rust core returned no result.")
        } else {
          promise.resolve(result)
        }
      } catch (error: Throwable) {
        promise.reject("NITO_RUST_FFI_ERROR", error.message, error)
      }
    }
  }

  companion object {
    const val NAME = "NitoWalletCrypto"

    private val executor = Executors.newFixedThreadPool(2) { task ->
      Thread(task, "nito-wallet-crypto").apply { isDaemon = true }
    }
    private val rustLinked = runCatching {
      System.loadLibrary("nito_wallet_crypto")
      true
    }.getOrDefault(false)
  }
}
