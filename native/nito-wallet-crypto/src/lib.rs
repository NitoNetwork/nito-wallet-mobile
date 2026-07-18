use std::{
    collections::HashMap,
    ffi::{CStr, CString, c_char},
    panic::{AssertUnwindSafe, catch_unwind},
    ptr,
    str::FromStr,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use bip39::{Language, Mnemonic};
use bitcoin::{
    Amount, PublicKey, ScriptBuf, TxOut, base58,
    bech32::{Hrp, segwit},
    bip32::{DerivationPath, Xpriv},
    hashes::{Hash, hash160},
    key::TapTweak,
    psbt::Psbt,
    secp256k1::{Keypair, Message, Secp256k1, SecretKey},
    sighash::{EcdsaSighashType, Prevouts, SighashCache, TapSighashType},
};
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use thiserror::Error;
use zeroize::Zeroize;

const NITO_HRP: &str = "nito";
const NITO_P2PKH_PREFIX: u8 = 0x00;
const NITO_P2SH_PREFIX: u8 = 0x05;
const MAX_PBKDF2_ROUNDS: u32 = 2_000_000;

#[derive(Debug, Error)]
enum CryptoError {
    #[error("Invalid request: {0}")]
    InvalidRequest(String),
    #[error("Invalid mnemonic")]
    InvalidMnemonic,
    #[error("Invalid derivation path: {0}")]
    InvalidPath(String),
    #[error("Invalid PSBT: {0}")]
    InvalidPsbt(String),
    #[error("Missing previous output for input {0}")]
    MissingPrevout(usize),
    #[error("Missing signer metadata for input {0}")]
    MissingSigner(usize),
    #[error("Cryptographic operation failed: {0}")]
    Crypto(String),
}

impl CryptoError {
    fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "INVALID_REQUEST",
            Self::InvalidMnemonic => "INVALID_MNEMONIC",
            Self::InvalidPath(_) => "INVALID_DERIVATION_PATH",
            Self::InvalidPsbt(_) => "INVALID_PSBT",
            Self::MissingPrevout(_) => "MISSING_PREVOUT",
            Self::MissingSigner(_) => "MISSING_SIGNER",
            Self::Crypto(_) => "CRYPTO_ERROR",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ScriptType {
    P2pkh,
    P2shP2wpkh,
    P2wpkh,
    P2tr,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pbkdf2Request {
    password: String,
    salt_base64: String,
    rounds: u32,
    output_length: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Pbkdf2Response {
    key_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeriveAddressesRequest {
    mnemonic: String,
    requests: Vec<DeriveAddressRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeriveAddressRequest {
    path: String,
    script_type: ScriptType,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DerivedAddressResponse {
    path: String,
    address: String,
    public_key_hex: String,
    script_hex: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    redeem_script_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tap_internal_key_hex: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignPsbtRequest {
    mnemonic: String,
    psbt_base64: String,
    signers: Vec<SignerRequest>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignerRequest {
    txid: String,
    vout: u32,
    path: String,
    script_type: ScriptType,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignPsbtResponse {
    psbt_base64: String,
}

fn parse_json<T: for<'de> Deserialize<'de>>(request: &str) -> Result<T, CryptoError> {
    serde_json::from_str(request).map_err(|error| CryptoError::InvalidRequest(error.to_string()))
}

fn master_xpriv(mnemonic: &str) -> Result<Xpriv, CryptoError> {
    let parsed = Mnemonic::parse_in_normalized(Language::English, mnemonic)
        .map_err(|_| CryptoError::InvalidMnemonic)?;
    let mut seed = parsed.to_seed_normalized("");
    let root = Xpriv::new_master(bitcoin::NetworkKind::Main, &seed)
        .map_err(|error| CryptoError::Crypto(error.to_string()));
    seed.zeroize();
    root
}

fn derive_secret(root: &Xpriv, path: &str) -> Result<SecretKey, CryptoError> {
    let derivation_path =
        DerivationPath::from_str(path).map_err(|_| CryptoError::InvalidPath(path.to_owned()))?;
    root.derive_priv(&Secp256k1::new(), &derivation_path)
        .map(|child| child.private_key)
        .map_err(|_| CryptoError::InvalidPath(path.to_owned()))
}

fn base58_address(prefix: u8, payload: &[u8]) -> String {
    let mut value = Vec::with_capacity(payload.len() + 1);
    value.push(prefix);
    value.extend_from_slice(payload);
    base58::encode_check(&value)
}

fn derive_address(
    root: &Xpriv,
    request: DeriveAddressRequest,
) -> Result<DerivedAddressResponse, CryptoError> {
    let secp = Secp256k1::new();
    let secret_key = derive_secret(root, &request.path)?;
    let secp_public_key = bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &secret_key);
    let public_key = PublicKey::new(secp_public_key);
    let public_key_hash = public_key.pubkey_hash();
    let witness_key_hash = public_key
        .wpubkey_hash()
        .map_err(|error| CryptoError::Crypto(error.to_string()))?;

    let (address, script, redeem_script_hex, tap_internal_key_hex) = match request.script_type {
        ScriptType::P2pkh => {
            let script = ScriptBuf::new_p2pkh(&public_key_hash);
            (
                base58_address(NITO_P2PKH_PREFIX, public_key_hash.as_byte_array()),
                script,
                None,
                None,
            )
        }
        ScriptType::P2shP2wpkh => {
            let redeem_script = ScriptBuf::new_p2wpkh(&witness_key_hash);
            let script_hash = hash160::Hash::hash(redeem_script.as_bytes());
            let script = ScriptBuf::new_p2sh(&bitcoin::ScriptHash::from_byte_array(
                script_hash.to_byte_array(),
            ));
            (
                base58_address(NITO_P2SH_PREFIX, script_hash.as_byte_array()),
                script,
                Some(hex::encode(redeem_script.as_bytes())),
                None,
            )
        }
        ScriptType::P2wpkh => {
            let script = ScriptBuf::new_p2wpkh(&witness_key_hash);
            let hrp =
                Hrp::parse(NITO_HRP).map_err(|error| CryptoError::Crypto(error.to_string()))?;
            let address = segwit::encode(hrp, segwit::VERSION_0, witness_key_hash.as_byte_array())
                .map_err(|error| CryptoError::Crypto(error.to_string()))?;
            (address, script, None, None)
        }
        ScriptType::P2tr => {
            let keypair = Keypair::from_secret_key(&secp, &secret_key);
            let (internal_key, _) = keypair.x_only_public_key();
            let (output_key, _) = internal_key.tap_tweak(&secp, None);
            let output_key = output_key.to_x_only_public_key();
            let script = ScriptBuf::new_p2tr(&secp, internal_key, None);
            let hrp =
                Hrp::parse(NITO_HRP).map_err(|error| CryptoError::Crypto(error.to_string()))?;
            let address = segwit::encode(hrp, segwit::VERSION_1, &output_key.serialize())
                .map_err(|error| CryptoError::Crypto(error.to_string()))?;
            (
                address,
                script,
                None,
                Some(hex::encode(internal_key.serialize())),
            )
        }
    };

    Ok(DerivedAddressResponse {
        path: request.path,
        address,
        public_key_hex: hex::encode(public_key.to_bytes()),
        script_hex: hex::encode(script.as_bytes()),
        redeem_script_hex,
        tap_internal_key_hex,
    })
}

fn pbkdf2(request: &str) -> Result<Value, CryptoError> {
    let mut request: Pbkdf2Request = parse_json(request)?;
    if request.rounds == 0 || request.rounds > MAX_PBKDF2_ROUNDS {
        return Err(CryptoError::InvalidRequest(
            "PBKDF2 rounds out of range".into(),
        ));
    }
    if request.output_length == 0 || request.output_length > 64 {
        return Err(CryptoError::InvalidRequest(
            "PBKDF2 output length out of range".into(),
        ));
    }
    let salt = BASE64
        .decode(&request.salt_base64)
        .map_err(|error| CryptoError::InvalidRequest(error.to_string()))?;
    let mut output = vec![0_u8; request.output_length];
    pbkdf2_hmac::<Sha256>(
        request.password.as_bytes(),
        &salt,
        request.rounds,
        &mut output,
    );
    request.password.zeroize();
    let response = Pbkdf2Response {
        key_base64: BASE64.encode(&output),
    };
    output.zeroize();
    serde_json::to_value(response).map_err(|error| CryptoError::Crypto(error.to_string()))
}

fn derive_addresses(request: &str) -> Result<Value, CryptoError> {
    let mut request: DeriveAddressesRequest = parse_json(request)?;
    if request.requests.is_empty() || request.requests.len() > 256 {
        return Err(CryptoError::InvalidRequest(
            "Address batch size out of range".into(),
        ));
    }
    let root = master_xpriv(&request.mnemonic)?;
    request.mnemonic.zeroize();
    let addresses = request
        .requests
        .into_iter()
        .map(|item| derive_address(&root, item))
        .collect::<Result<Vec<_>, _>>()?;
    serde_json::to_value(addresses).map_err(|error| CryptoError::Crypto(error.to_string()))
}

fn previous_output(psbt: &Psbt, index: usize) -> Result<TxOut, CryptoError> {
    let input = psbt
        .inputs
        .get(index)
        .ok_or(CryptoError::MissingPrevout(index))?;
    if let Some(output) = &input.witness_utxo {
        return Ok(output.clone());
    }
    let outpoint = psbt
        .unsigned_tx
        .input
        .get(index)
        .ok_or(CryptoError::MissingPrevout(index))?
        .previous_output;
    input
        .non_witness_utxo
        .as_ref()
        .and_then(|transaction| transaction.output.get(outpoint.vout as usize))
        .cloned()
        .ok_or(CryptoError::MissingPrevout(index))
}

enum PendingSignature {
    Ecdsa(usize, PublicKey, bitcoin::ecdsa::Signature),
    Taproot(usize, bitcoin::taproot::Signature),
}

fn sign_psbt(request: &str) -> Result<Value, CryptoError> {
    let mut request: SignPsbtRequest = parse_json(request)?;
    let raw_psbt = BASE64
        .decode(&request.psbt_base64)
        .map_err(|error| CryptoError::InvalidPsbt(error.to_string()))?;
    let mut psbt = Psbt::deserialize(&raw_psbt)
        .map_err(|error| CryptoError::InvalidPsbt(error.to_string()))?;
    let root = master_xpriv(&request.mnemonic)?;
    request.mnemonic.zeroize();
    let signers: HashMap<(String, u32), SignerRequest> = request
        .signers
        .into_iter()
        .map(|signer| ((signer.txid.to_lowercase(), signer.vout), signer))
        .collect();
    let prevouts = (0..psbt.inputs.len())
        .map(|index| previous_output(&psbt, index))
        .collect::<Result<Vec<_>, _>>()?;
    let secp = Secp256k1::new();
    let signatures = {
        let mut cache = SighashCache::new(&psbt.unsigned_tx);
        let mut signatures = Vec::with_capacity(psbt.inputs.len());

        for (index, transaction_input) in psbt.unsigned_tx.input.iter().enumerate() {
            let outpoint = transaction_input.previous_output;
            let signer = signers
                .get(&(outpoint.txid.to_string().to_lowercase(), outpoint.vout))
                .ok_or(CryptoError::MissingSigner(index))?;
            let secret_key = derive_secret(&root, &signer.path)?;
            let secp_public_key =
                bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &secret_key);
            let public_key = PublicKey::new(secp_public_key);

            match signer.script_type {
                ScriptType::P2tr => {
                    let sighash = cache
                        .taproot_key_spend_signature_hash(
                            index,
                            &Prevouts::All(&prevouts),
                            TapSighashType::Default,
                        )
                        .map_err(|error| CryptoError::Crypto(error.to_string()))?;
                    let message = Message::from_digest(sighash.to_byte_array());
                    let keypair = Keypair::from_secret_key(&secp, &secret_key)
                        .tap_tweak(&secp, None)
                        .to_keypair();
                    let signature = secp.sign_schnorr_no_aux_rand(&message, &keypair);
                    signatures.push(PendingSignature::Taproot(
                        index,
                        bitcoin::taproot::Signature {
                            signature,
                            sighash_type: TapSighashType::Default,
                        },
                    ));
                }
                ScriptType::P2pkh => {
                    let sighash = cache
                        .legacy_signature_hash(
                            index,
                            &prevouts[index].script_pubkey,
                            EcdsaSighashType::All.to_u32(),
                        )
                        .map_err(|error| CryptoError::Crypto(error.to_string()))?;
                    let message = Message::from_digest(sighash.to_byte_array());
                    let signature = secp.sign_ecdsa(&message, &secret_key);
                    signatures.push(PendingSignature::Ecdsa(
                        index,
                        public_key,
                        bitcoin::ecdsa::Signature {
                            signature,
                            sighash_type: EcdsaSighashType::All,
                        },
                    ));
                }
                ScriptType::P2shP2wpkh | ScriptType::P2wpkh => {
                    let witness_program = match signer.script_type {
                        ScriptType::P2shP2wpkh => {
                            psbt.inputs[index].redeem_script.as_ref().ok_or_else(|| {
                                CryptoError::InvalidPsbt("Missing P2SH redeem script".into())
                            })?
                        }
                        ScriptType::P2wpkh => &prevouts[index].script_pubkey,
                        _ => unreachable!(),
                    };
                    let sighash = cache
                        .p2wpkh_signature_hash(
                            index,
                            witness_program,
                            Amount::from_sat(prevouts[index].value.to_sat()),
                            EcdsaSighashType::All,
                        )
                        .map_err(|error| CryptoError::Crypto(error.to_string()))?;
                    let message = Message::from_digest(sighash.to_byte_array());
                    let signature = secp.sign_ecdsa(&message, &secret_key);
                    signatures.push(PendingSignature::Ecdsa(
                        index,
                        public_key,
                        bitcoin::ecdsa::Signature {
                            signature,
                            sighash_type: EcdsaSighashType::All,
                        },
                    ));
                }
            }
        }

        signatures
    };

    for signature in signatures {
        match signature {
            PendingSignature::Ecdsa(index, public_key, signature) => {
                psbt.inputs[index]
                    .partial_sigs
                    .insert(public_key, signature);
            }
            PendingSignature::Taproot(index, signature) => {
                psbt.inputs[index].tap_key_sig = Some(signature);
            }
        }
    }

    let response = SignPsbtResponse {
        psbt_base64: BASE64.encode(psbt.serialize()),
    };
    serde_json::to_value(response).map_err(|error| CryptoError::Crypto(error.to_string()))
}

fn dispatch(operation: &str, request: &str) -> Result<Value, CryptoError> {
    match operation {
        "pbkdf2" => pbkdf2(request),
        "deriveAddresses" => derive_addresses(request),
        "signPsbt" => sign_psbt(request),
        _ => Err(CryptoError::InvalidRequest(format!(
            "Unknown operation: {operation}"
        ))),
    }
}

fn invoke_envelope(operation: &str, request: &str) -> String {
    match catch_unwind(AssertUnwindSafe(|| dispatch(operation, request))) {
        Ok(Ok(result)) => json!({ "ok": true, "result": result }).to_string(),
        Ok(Err(error)) => json!({
            "ok": false,
            "error": { "code": error.code(), "message": error.to_string() }
        })
        .to_string(),
        Err(_) => json!({
            "ok": false,
            "error": { "code": "RUST_PANIC", "message": "Native cryptographic operation aborted" }
        })
        .to_string(),
    }
}

#[unsafe(no_mangle)]
/// Invokes the native cryptographic dispatcher.
///
/// # Safety
///
/// `operation` and `request_json` must be valid, non-null, NUL-terminated C strings for the
/// duration of this call. The returned pointer must be released exactly once with
/// [`nito_wallet_crypto_free`].
pub unsafe extern "C" fn nito_wallet_crypto_invoke(
    operation: *const c_char,
    request_json: *const c_char,
) -> *mut c_char {
    if operation.is_null() || request_json.is_null() {
        return ptr::null_mut();
    }
    let operation = unsafe { CStr::from_ptr(operation) }.to_string_lossy();
    let request_json = unsafe { CStr::from_ptr(request_json) }.to_string_lossy();
    CString::new(invoke_envelope(&operation, &request_json))
        .map(CString::into_raw)
        .unwrap_or(ptr::null_mut())
}

#[unsafe(no_mangle)]
/// Releases a string returned by [`nito_wallet_crypto_invoke`].
///
/// # Safety
///
/// `value` must either be null or a pointer returned by [`nito_wallet_crypto_invoke`] that has
/// not already been released.
pub unsafe extern "C" fn nito_wallet_crypto_free(value: *mut c_char) {
    if !value.is_null() {
        unsafe { drop(CString::from_raw(value)) };
    }
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_network_nito_wallet_nativecore_NitoWalletCryptoModule_nativeInvoke<
    'local,
>(
    mut env: jni::JNIEnv<'local>,
    _object: jni::objects::JObject<'local>,
    operation: jni::objects::JString<'local>,
    request_json: jni::objects::JString<'local>,
) -> jni::sys::jstring {
    let operation: String = match env.get_string(&operation) {
        Ok(value) => value.into(),
        Err(_) => return ptr::null_mut(),
    };
    let request_json: String = match env.get_string(&request_json) {
        Ok(value) => value.into(),
        Err(_) => return ptr::null_mut(),
    };
    env.new_string(invoke_envelope(&operation, &request_json))
        .map(|value| value.into_raw())
        .unwrap_or(ptr::null_mut())
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::{
        OutPoint, Sequence, Transaction, TxIn, Txid, Witness, absolute, transaction::Version,
    };

    const MNEMONIC: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn pbkdf2_sha256_matches_known_vector() {
        let response = pbkdf2(
            &json!({
                "password": "password",
                "saltBase64": BASE64.encode("salt"),
                "rounds": 1,
                "outputLength": 32
            })
            .to_string(),
        )
        .unwrap();
        let key = response.get("keyBase64").and_then(Value::as_str).unwrap();
        assert_eq!(
            hex::encode(BASE64.decode(key).unwrap()),
            "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
        );
    }

    #[test]
    fn derives_web_wallet_primary_address() {
        let response = derive_addresses(
            &json!({
                "mnemonic": MNEMONIC,
                "requests": [{ "path": "m/84'/0'/0'/0/0", "scriptType": "p2wpkh" }]
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(
            response.as_array().unwrap()[0]
                .get("address")
                .and_then(Value::as_str),
            Some("nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02")
        );
    }

    #[test]
    fn signs_a_p2wpkh_psbt_without_exporting_a_private_key() {
        let root = master_xpriv(MNEMONIC).unwrap();
        let secret_key = derive_secret(&root, "m/84'/0'/0'/0/0").unwrap();
        let secp = Secp256k1::new();
        let public_key = PublicKey::new(bitcoin::secp256k1::PublicKey::from_secret_key(
            &secp,
            &secret_key,
        ));
        let script = ScriptBuf::new_p2wpkh(&public_key.wpubkey_hash().unwrap());
        let outpoint = OutPoint::new(Txid::from_byte_array([0x11; 32]), 0);
        let unsigned = Transaction {
            version: Version::TWO,
            lock_time: absolute::LockTime::ZERO,
            input: vec![TxIn {
                previous_output: outpoint,
                script_sig: ScriptBuf::new(),
                sequence: Sequence::MAX,
                witness: Witness::new(),
            }],
            output: vec![TxOut {
                value: Amount::from_sat(90_000),
                script_pubkey: script.clone(),
            }],
        };
        let mut psbt = Psbt::from_unsigned_tx(unsigned).unwrap();
        psbt.inputs[0].witness_utxo = Some(TxOut {
            value: Amount::from_sat(100_000),
            script_pubkey: script,
        });
        let response = sign_psbt(
            &json!({
                "mnemonic": MNEMONIC,
                "psbtBase64": BASE64.encode(psbt.serialize()),
                "signers": [{
                    "txid": outpoint.txid.to_string(),
                    "vout": 0,
                    "path": "m/84'/0'/0'/0/0",
                    "scriptType": "p2wpkh"
                }]
            })
            .to_string(),
        )
        .unwrap();
        let signed = Psbt::deserialize(
            &BASE64
                .decode(response.get("psbtBase64").and_then(Value::as_str).unwrap())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(signed.inputs[0].partial_sigs.len(), 1);
    }

    #[test]
    fn signs_a_bip86_taproot_psbt() {
        let root = master_xpriv(MNEMONIC).unwrap();
        let secret_key = derive_secret(&root, "m/86'/0'/0'/0/0").unwrap();
        let secp = Secp256k1::new();
        let keypair = Keypair::from_secret_key(&secp, &secret_key);
        let (internal_key, _) = keypair.x_only_public_key();
        let script = ScriptBuf::new_p2tr(&secp, internal_key, None);
        let outpoint = OutPoint::new(Txid::from_byte_array([0x22; 32]), 1);
        let unsigned = Transaction {
            version: Version::TWO,
            lock_time: absolute::LockTime::ZERO,
            input: vec![TxIn {
                previous_output: outpoint,
                script_sig: ScriptBuf::new(),
                sequence: Sequence::MAX,
                witness: Witness::new(),
            }],
            output: vec![TxOut {
                value: Amount::from_sat(90_000),
                script_pubkey: script.clone(),
            }],
        };
        let mut psbt = Psbt::from_unsigned_tx(unsigned).unwrap();
        psbt.inputs[0].witness_utxo = Some(TxOut {
            value: Amount::from_sat(100_000),
            script_pubkey: script,
        });
        psbt.inputs[0].tap_internal_key = Some(internal_key);
        let response = sign_psbt(
            &json!({
                "mnemonic": MNEMONIC,
                "psbtBase64": BASE64.encode(psbt.serialize()),
                "signers": [{
                    "txid": outpoint.txid.to_string(),
                    "vout": 1,
                    "path": "m/86'/0'/0'/0/0",
                    "scriptType": "p2tr"
                }]
            })
            .to_string(),
        )
        .unwrap();
        let signed = Psbt::deserialize(
            &BASE64
                .decode(response.get("psbtBase64").and_then(Value::as_str).unwrap())
                .unwrap(),
        )
        .unwrap();
        assert!(signed.inputs[0].tap_key_sig.is_some());
    }

    #[test]
    fn signs_a_legacy_p2pkh_psbt() {
        let root = master_xpriv(MNEMONIC).unwrap();
        let secret_key = derive_secret(&root, "m/44'/0'/0'/0/0").unwrap();
        let secp = Secp256k1::new();
        let public_key = PublicKey::new(bitcoin::secp256k1::PublicKey::from_secret_key(
            &secp,
            &secret_key,
        ));
        let script = ScriptBuf::new_p2pkh(&public_key.pubkey_hash());
        let previous = Transaction {
            version: Version::TWO,
            lock_time: absolute::LockTime::ZERO,
            input: vec![],
            output: vec![TxOut {
                value: Amount::from_sat(100_000),
                script_pubkey: script.clone(),
            }],
        };
        let outpoint = OutPoint::new(previous.compute_txid(), 0);
        let unsigned = Transaction {
            version: Version::TWO,
            lock_time: absolute::LockTime::ZERO,
            input: vec![TxIn {
                previous_output: outpoint,
                script_sig: ScriptBuf::new(),
                sequence: Sequence::MAX,
                witness: Witness::new(),
            }],
            output: vec![TxOut {
                value: Amount::from_sat(90_000),
                script_pubkey: script,
            }],
        };
        let mut psbt = Psbt::from_unsigned_tx(unsigned).unwrap();
        psbt.inputs[0].non_witness_utxo = Some(previous);
        let response = sign_psbt(
            &json!({
                "mnemonic": MNEMONIC,
                "psbtBase64": BASE64.encode(psbt.serialize()),
                "signers": [{
                    "txid": outpoint.txid.to_string(),
                    "vout": 0,
                    "path": "m/44'/0'/0'/0/0",
                    "scriptType": "p2pkh"
                }]
            })
            .to_string(),
        )
        .unwrap();
        let signed = Psbt::deserialize(
            &BASE64
                .decode(response.get("psbtBase64").and_then(Value::as_str).unwrap())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(signed.inputs[0].partial_sigs.len(), 1);
    }

    #[test]
    fn signs_a_nested_segwit_psbt() {
        let root = master_xpriv(MNEMONIC).unwrap();
        let secret_key = derive_secret(&root, "m/49'/0'/0'/0/0").unwrap();
        let secp = Secp256k1::new();
        let public_key = PublicKey::new(bitcoin::secp256k1::PublicKey::from_secret_key(
            &secp,
            &secret_key,
        ));
        let redeem_script = ScriptBuf::new_p2wpkh(&public_key.wpubkey_hash().unwrap());
        let script = ScriptBuf::new_p2sh(&redeem_script.script_hash());
        let outpoint = OutPoint::new(Txid::from_byte_array([0x33; 32]), 0);
        let unsigned = Transaction {
            version: Version::TWO,
            lock_time: absolute::LockTime::ZERO,
            input: vec![TxIn {
                previous_output: outpoint,
                script_sig: ScriptBuf::new(),
                sequence: Sequence::MAX,
                witness: Witness::new(),
            }],
            output: vec![TxOut {
                value: Amount::from_sat(90_000),
                script_pubkey: script.clone(),
            }],
        };
        let mut psbt = Psbt::from_unsigned_tx(unsigned).unwrap();
        psbt.inputs[0].witness_utxo = Some(TxOut {
            value: Amount::from_sat(100_000),
            script_pubkey: script,
        });
        psbt.inputs[0].redeem_script = Some(redeem_script);
        let response = sign_psbt(
            &json!({
                "mnemonic": MNEMONIC,
                "psbtBase64": BASE64.encode(psbt.serialize()),
                "signers": [{
                    "txid": outpoint.txid.to_string(),
                    "vout": 0,
                    "path": "m/49'/0'/0'/0/0",
                    "scriptType": "p2sh-p2wpkh"
                }]
            })
            .to_string(),
        )
        .unwrap();
        let signed = Psbt::deserialize(
            &BASE64
                .decode(response.get("psbtBase64").and_then(Value::as_str).unwrap())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(signed.inputs[0].partial_sigs.len(), 1);
    }
}
