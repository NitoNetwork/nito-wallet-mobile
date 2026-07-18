package network.nito.wallet.nativecore

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NitoWalletCorePackage : BaseReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext
  ): NativeModule? = when (name) {
    NitoWalletCryptoModule.NAME -> NitoWalletCryptoModule(reactContext)
    else -> null
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        NitoWalletCryptoModule.NAME to moduleInfo(
          NitoWalletCryptoModule.NAME,
          NitoWalletCryptoModule::class.java.name
        )
      )
    }

  private fun moduleInfo(name: String, className: String): ReactModuleInfo =
    ReactModuleInfo(
      name,
      className,
      false,
      false,
      false,
      false
    )
}
