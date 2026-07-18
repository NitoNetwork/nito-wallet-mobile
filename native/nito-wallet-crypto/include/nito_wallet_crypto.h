#ifndef NITO_WALLET_CRYPTO_H
#define NITO_WALLET_CRYPTO_H

#ifdef __cplusplus
extern "C" {
#endif

char *nito_wallet_crypto_invoke(const char *operation, const char *request_json);
void nito_wallet_crypto_free(char *value);

#ifdef __cplusplus
}
#endif

#endif
