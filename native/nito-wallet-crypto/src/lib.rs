#[cfg(any(
    getrandom_backend,
    getrandom_backend = "custom",
    getrandom_backend = "efi_rng",
    getrandom_backend = "extern_impl",
    getrandom_backend = "linux_getrandom",
    getrandom_backend = "linux_raw",
    getrandom_backend = "rdrand",
    getrandom_backend = "rndr",
    getrandom_backend = "unsupported",
    getrandom_backend = "windows_legacy",
))]
compile_error!(
    "getrandom_backend must not be overridden: the wallet requires the OS CSPRNG backend."
);

use std::{
    collections::HashMap,
    ffi::{CStr, CString, c_char},
    ops::Deref,
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
use zeroize::{Zeroize, Zeroizing};

const NITO_HRP: &str = "nito";
const NITO_P2PKH_PREFIX: u8 = 0x00;
const NITO_P2SH_PREFIX: u8 = 0x05;
const MAX_PBKDF2_ROUNDS: u32 = 2_000_000;
const MIN_RANDOM_BYTES: usize = 16;
const MAX_RANDOM_BYTES: usize = 1024;
const SEED_ENTROPY_BYTES: usize = 32;

#[derive(Default, Deserialize)]
#[serde(transparent)]
struct SensitiveString(String);

impl Deref for SensitiveString {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Drop for SensitiveString {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

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
    #[error("System entropy is unavailable")]
    Entropy,
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
            Self::Entropy => "ENTROPY_UNAVAILABLE",
        }
    }
}

#[derive(Deserialize)]
struct RandomBytesRequest {
    length: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RandomBytesResponse {
    bytes_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateMnemonicRequest {
    additional_entropy_base64: Option<String>,
}

#[derive(Serialize)]
struct GenerateMnemonicResponse {
    mnemonic: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
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
    mnemonic: SensitiveString,
    #[serde(default)]
    bip39_passphrase: SensitiveString,
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
    script_type: ScriptType,
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
    mnemonic: SensitiveString,
    #[serde(default)]
    bip39_passphrase: SensitiveString,
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

fn fill_random_with<E>(
    buffer: &mut [u8],
    fill: impl FnOnce(&mut [u8]) -> Result<(), E>,
) -> Result<(), CryptoError> {
    if fill(buffer).is_err() || buffer.iter().all(|byte| *byte == 0) {
        buffer.zeroize();
        return Err(CryptoError::Entropy);
    }
    Ok(())
}

fn fill_os_random(buffer: &mut [u8]) -> Result<(), CryptoError> {
    fill_random_with(buffer, getrandom::fill)
}

fn random_bytes(request: &str) -> Result<Value, CryptoError> {
    let request: RandomBytesRequest = parse_json(request)?;
    if !(MIN_RANDOM_BYTES..=MAX_RANDOM_BYTES).contains(&request.length) {
        return Err(CryptoError::InvalidRequest(format!(
            "random byte length must be between {MIN_RANDOM_BYTES} and {MAX_RANDOM_BYTES}"
        )));
    }

    let mut bytes = Zeroizing::new(vec![0_u8; request.length]);
    fill_os_random(bytes.as_mut_slice())?;
    serde_json::to_value(RandomBytesResponse {
        bytes_base64: BASE64.encode(bytes.as_slice()),
    })
    .map_err(|error| CryptoError::Crypto(error.to_string()))
}

fn mix_seed_entropy_with<E>(
    additional_entropy: &[u8],
    fill: impl FnOnce(&mut [u8]) -> Result<(), E>,
) -> Result<Zeroizing<[u8; SEED_ENTROPY_BYTES]>, CryptoError> {
    if additional_entropy.len() != SEED_ENTROPY_BYTES {
        return Err(CryptoError::InvalidRequest(format!(
            "additional entropy must contain exactly {SEED_ENTROPY_BYTES} bytes"
        )));
    }
    let mut system_entropy = Zeroizing::new([0_u8; SEED_ENTROPY_BYTES]);
    fill_random_with(system_entropy.as_mut(), fill)?;
    let mut mixed_entropy = Zeroizing::new([0_u8; SEED_ENTROPY_BYTES]);
    for index in 0..SEED_ENTROPY_BYTES {
        mixed_entropy[index] = system_entropy[index] ^ additional_entropy[index];
    }
    system_entropy.zeroize();
    Ok(mixed_entropy)
}

fn generate_mnemonic(request: &str) -> Result<Value, CryptoError> {
    let request: GenerateMnemonicRequest = parse_json(request)?;
    let additional_entropy = match request.additional_entropy_base64 {
        Some(mut encoded) => {
            let decoded = BASE64.decode(encoded.as_bytes());
            encoded.zeroize();
            let decoded = Zeroizing::new(decoded.map_err(|_| {
                CryptoError::InvalidRequest("additional entropy is not valid base64".into())
            })?);
            if decoded.len() != SEED_ENTROPY_BYTES {
                return Err(CryptoError::InvalidRequest(format!(
                    "additional entropy must contain exactly {SEED_ENTROPY_BYTES} bytes"
                )));
            }
            decoded
        }
        None => Zeroizing::new(vec![0_u8; SEED_ENTROPY_BYTES]),
    };

    // Additional entropy is fully validated before fresh system entropy is drawn.
    // The caller provides a domain-separated SHA-256 digest of physical rolls.
    let mixed_entropy = mix_seed_entropy_with(additional_entropy.as_slice(), getrandom::fill)?;

    let mnemonic = Mnemonic::from_entropy_in(Language::English, mixed_entropy.as_ref())
        .map_err(|error| CryptoError::Crypto(error.to_string()))?;
    serde_json::to_value(GenerateMnemonicResponse {
        mnemonic: mnemonic.to_string(),
    })
    .map_err(|error| CryptoError::Crypto(error.to_string()))
}

fn master_xpriv_with_passphrase(
    mnemonic: &str,
    bip39_passphrase: &str,
) -> Result<Xpriv, CryptoError> {
    let parsed = Mnemonic::parse_in_normalized(Language::English, mnemonic)
        .map_err(|_| CryptoError::InvalidMnemonic)?;
    let mut seed = parsed.to_seed(bip39_passphrase);
    let root = Xpriv::new_master(bitcoin::NetworkKind::Main, &seed)
        .map_err(|error| CryptoError::Crypto(error.to_string()));
    seed.zeroize();
    root
}

#[cfg(test)]
fn master_xpriv(mnemonic: &str) -> Result<Xpriv, CryptoError> {
    master_xpriv_with_passphrase(mnemonic, "")
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
        script_type: request.script_type,
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
    let request: DeriveAddressesRequest = parse_json(request)?;
    if request.requests.is_empty() || request.requests.len() > 256 {
        return Err(CryptoError::InvalidRequest(
            "Address batch size out of range".into(),
        ));
    }
    let root = master_xpriv_with_passphrase(&request.mnemonic, &request.bip39_passphrase)?;
    let addresses = request
        .requests
        .into_iter()
        .map(|item| derive_address(&root, item))
        .collect::<Result<Vec<_>, _>>()?;
    serde_json::to_value(addresses).map_err(|error| CryptoError::Crypto(error.to_string()))
}

fn non_witness_previous_output(psbt: &Psbt, index: usize) -> Result<TxOut, CryptoError> {
    let input = psbt
        .inputs
        .get(index)
        .ok_or(CryptoError::MissingPrevout(index))?;
    let outpoint = psbt
        .unsigned_tx
        .input
        .get(index)
        .ok_or(CryptoError::MissingPrevout(index))?
        .previous_output;
    let transaction = input
        .non_witness_utxo
        .as_ref()
        .ok_or(CryptoError::MissingPrevout(index))?;
    if transaction.compute_txid() != outpoint.txid {
        return Err(CryptoError::InvalidPsbt(format!(
            "Non-witness transaction does not match input {index}"
        )));
    }
    transaction
        .output
        .get(outpoint.vout as usize)
        .cloned()
        .ok_or(CryptoError::MissingPrevout(index))
}

fn witness_previous_output(psbt: &Psbt, index: usize) -> Result<TxOut, CryptoError> {
    let input = psbt
        .inputs
        .get(index)
        .ok_or(CryptoError::MissingPrevout(index))?;
    let output = input
        .witness_utxo
        .as_ref()
        .cloned()
        .ok_or(CryptoError::MissingPrevout(index))?;
    if input.non_witness_utxo.is_some() && non_witness_previous_output(psbt, index)? != output {
        return Err(CryptoError::InvalidPsbt(format!(
            "Previous output records disagree for input {index}"
        )));
    }
    Ok(output)
}

struct ValidatedSignerInput {
    index: usize,
    script_type: ScriptType,
    secret_key: SecretKey,
    public_key: PublicKey,
    previous_output: TxOut,
    witness_program: Option<ScriptBuf>,
}

#[derive(Clone)]
struct SignerKeyMaterial {
    secret_key: SecretKey,
    public_key: PublicKey,
}

fn signer_key_material(
    cache: &mut HashMap<String, SignerKeyMaterial>,
    root: &Xpriv,
    path: &str,
    secp: &Secp256k1<bitcoin::secp256k1::All>,
) -> Result<SignerKeyMaterial, CryptoError> {
    if let Some(material) = cache.get(path) {
        return Ok(material.clone());
    }

    let secret_key = derive_secret(root, path)?;
    let secp_public_key = bitcoin::secp256k1::PublicKey::from_secret_key(secp, &secret_key);
    let material = SignerKeyMaterial {
        secret_key,
        public_key: PublicKey::new(secp_public_key),
    };
    cache.insert(path.to_owned(), material.clone());
    Ok(material)
}

fn validate_signer_inputs(
    psbt: &Psbt,
    root: &Xpriv,
    signers: &HashMap<(String, u32), SignerRequest>,
    secp: &Secp256k1<bitcoin::secp256k1::All>,
) -> Result<Vec<ValidatedSignerInput>, CryptoError> {
    let mut key_material_by_path = HashMap::new();
    psbt.unsigned_tx
        .input
        .iter()
        .enumerate()
        .map(|(index, transaction_input)| {
            let outpoint = transaction_input.previous_output;
            let signer = signers
                .get(&(outpoint.txid.to_string().to_lowercase(), outpoint.vout))
                .ok_or(CryptoError::MissingSigner(index))?;
            let SignerKeyMaterial {
                secret_key,
                public_key,
            } = signer_key_material(&mut key_material_by_path, root, &signer.path, secp)?;
            let psbt_input = psbt
                .inputs
                .get(index)
                .ok_or(CryptoError::MissingPrevout(index))?;

            let (previous_output, expected_script, witness_program) = match signer.script_type {
                ScriptType::P2pkh => {
                    let previous_output = non_witness_previous_output(psbt, index)?;
                    let expected_script = ScriptBuf::new_p2pkh(&public_key.pubkey_hash());
                    (previous_output, expected_script, None)
                }
                ScriptType::P2shP2wpkh => {
                    let previous_output = witness_previous_output(psbt, index)?;
                    let witness_key_hash = public_key
                        .wpubkey_hash()
                        .map_err(|error| CryptoError::Crypto(error.to_string()))?;
                    let expected_redeem_script = ScriptBuf::new_p2wpkh(&witness_key_hash);
                    if psbt_input.redeem_script.as_ref() != Some(&expected_redeem_script) {
                        return Err(CryptoError::InvalidPsbt(format!(
                            "P2SH redeem script does not match signer for input {index}"
                        )));
                    }
                    let expected_script =
                        ScriptBuf::new_p2sh(&expected_redeem_script.script_hash());
                    (
                        previous_output,
                        expected_script,
                        Some(expected_redeem_script),
                    )
                }
                ScriptType::P2wpkh => {
                    let previous_output = witness_previous_output(psbt, index)?;
                    let witness_key_hash = public_key
                        .wpubkey_hash()
                        .map_err(|error| CryptoError::Crypto(error.to_string()))?;
                    let expected_script = ScriptBuf::new_p2wpkh(&witness_key_hash);
                    (
                        previous_output,
                        expected_script.clone(),
                        Some(expected_script),
                    )
                }
                ScriptType::P2tr => {
                    let previous_output = witness_previous_output(psbt, index)?;
                    let keypair = Keypair::from_secret_key(secp, &secret_key);
                    let (internal_key, _) = keypair.x_only_public_key();
                    if psbt_input.tap_internal_key != Some(internal_key) {
                        return Err(CryptoError::InvalidPsbt(format!(
                            "Taproot internal key does not match signer for input {index}"
                        )));
                    }
                    let expected_script = ScriptBuf::new_p2tr(secp, internal_key, None);
                    (previous_output, expected_script, None)
                }
            };

            if previous_output.script_pubkey != expected_script {
                return Err(CryptoError::InvalidPsbt(format!(
                    "Previous output script does not match signer for input {index}"
                )));
            }

            Ok(ValidatedSignerInput {
                index,
                script_type: signer.script_type,
                secret_key,
                public_key,
                previous_output,
                witness_program,
            })
        })
        .collect()
}

enum PendingSignature {
    Ecdsa(usize, PublicKey, bitcoin::ecdsa::Signature),
    Taproot(usize, bitcoin::taproot::Signature),
}

fn sign_psbt(request: &str) -> Result<Value, CryptoError> {
    let request: SignPsbtRequest = parse_json(request)?;
    let raw_psbt = BASE64
        .decode(&request.psbt_base64)
        .map_err(|error| CryptoError::InvalidPsbt(error.to_string()))?;
    let mut psbt = Psbt::deserialize(&raw_psbt)
        .map_err(|error| CryptoError::InvalidPsbt(error.to_string()))?;
    let root = master_xpriv_with_passphrase(&request.mnemonic, &request.bip39_passphrase)?;
    let signers: HashMap<(String, u32), SignerRequest> = request
        .signers
        .into_iter()
        .map(|signer| ((signer.txid.to_lowercase(), signer.vout), signer))
        .collect();
    let secp = Secp256k1::new();
    let validated_inputs = validate_signer_inputs(&psbt, &root, &signers, &secp)?;
    let prevouts = validated_inputs
        .iter()
        .map(|input| input.previous_output.clone())
        .collect::<Vec<_>>();
    let signatures = {
        let mut cache = SighashCache::new(&psbt.unsigned_tx);
        let mut signatures = Vec::with_capacity(psbt.inputs.len());

        for input in &validated_inputs {
            let index = input.index;
            match input.script_type {
                ScriptType::P2tr => {
                    let sighash = cache
                        .taproot_key_spend_signature_hash(
                            index,
                            &Prevouts::All(&prevouts),
                            TapSighashType::Default,
                        )
                        .map_err(|error| CryptoError::Crypto(error.to_string()))?;
                    let message = Message::from_digest(sighash.to_byte_array());
                    let keypair = Keypair::from_secret_key(&secp, &input.secret_key)
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
                    let signature = secp.sign_ecdsa(&message, &input.secret_key);
                    signatures.push(PendingSignature::Ecdsa(
                        index,
                        input.public_key,
                        bitcoin::ecdsa::Signature {
                            signature,
                            sighash_type: EcdsaSighashType::All,
                        },
                    ));
                }
                ScriptType::P2shP2wpkh | ScriptType::P2wpkh => {
                    let witness_program = input.witness_program.as_ref().ok_or_else(|| {
                        CryptoError::InvalidPsbt(format!(
                            "Missing witness program for input {index}"
                        ))
                    })?;
                    let sighash = cache
                        .p2wpkh_signature_hash(
                            index,
                            witness_program,
                            Amount::from_sat(prevouts[index].value.to_sat()),
                            EcdsaSighashType::All,
                        )
                        .map_err(|error| CryptoError::Crypto(error.to_string()))?;
                    let message = Message::from_digest(sighash.to_byte_array());
                    let signature = secp.sign_ecdsa(&message, &input.secret_key);
                    signatures.push(PendingSignature::Ecdsa(
                        index,
                        input.public_key,
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
        "randomBytes" => random_bytes(request),
        "generateMnemonic" => generate_mnemonic(request),
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

    fn assert_valid_signatures(psbt: &Psbt) {
        let secp = Secp256k1::verification_only();
        let prevouts: Vec<TxOut> = psbt
            .iter_funding_utxos()
            .map(|out| out.unwrap().clone())
            .collect();
        let mut cache = SighashCache::new(&psbt.unsigned_tx);
        for (index, input) in psbt.inputs.iter().enumerate() {
            let prevout = &prevouts[index];
            if prevout.script_pubkey.is_p2tr() {
                let signature = input.tap_key_sig.unwrap();
                let output_key = bitcoin::secp256k1::XOnlyPublicKey::from_slice(
                    &prevout.script_pubkey.as_bytes()[2..],
                )
                .unwrap();
                let hash = cache
                    .taproot_key_spend_signature_hash(
                        index,
                        &Prevouts::All(&prevouts),
                        signature.sighash_type,
                    )
                    .unwrap();
                secp.verify_schnorr(
                    &signature.signature,
                    &Message::from_digest(hash.to_byte_array()),
                    &output_key,
                )
                .unwrap();
            } else {
                let (key, signature) = input.partial_sigs.iter().next().unwrap();
                let digest = if prevout.script_pubkey.is_p2pkh() {
                    cache
                        .legacy_signature_hash(
                            index,
                            &prevout.script_pubkey,
                            signature.sighash_type.to_u32(),
                        )
                        .unwrap()
                        .to_byte_array()
                } else {
                    let script = input
                        .redeem_script
                        .as_ref()
                        .unwrap_or(&prevout.script_pubkey);
                    cache
                        .p2wpkh_signature_hash(index, script, prevout.value, signature.sighash_type)
                        .unwrap()
                        .to_byte_array()
                };
                secp.verify_ecdsa(
                    &Message::from_digest(digest),
                    &signature.signature,
                    &key.inner,
                )
                .unwrap();
            }
        }
    }

    #[test]
    fn address_json_preserves_each_requested_script_type_and_path() {
        for (purpose, script_type) in [
            (44, "p2pkh"),
            (49, "p2sh-p2wpkh"),
            (84, "p2wpkh"),
            (86, "p2tr"),
        ] {
            for branch in [0, 1] {
                let path = format!("m/{purpose}'/0'/0'/{branch}/3");
                let response: Value = serde_json::from_str(&invoke_envelope(
                    "deriveAddresses",
                    &json!({
                        "mnemonic": MNEMONIC,
                        "requests": [{ "path": path, "scriptType": script_type }]
                    })
                    .to_string(),
                ))
                .unwrap();
                assert_eq!(response["ok"], true);
                assert_eq!(response["result"][0]["path"], path);
                assert_eq!(response["result"][0]["scriptType"], script_type);
            }
        }
    }

    #[test]
    fn native_derivation_normalizes_the_bip39_passphrase() {
        let derive = |bip39_passphrase: &str| {
            derive_addresses(
                &json!({
                    "mnemonic": MNEMONIC,
                    "bip39Passphrase": bip39_passphrase,
                    "requests": [{
                        "path": "m/86'/0'/0'/0/0",
                        "scriptType": "p2tr"
                    }]
                })
                .to_string(),
            )
            .unwrap()[0]["address"]
                .as_str()
                .unwrap()
                .to_owned()
        };

        assert_eq!(derive("é"), derive("e\u{301}"));
        assert_ne!(derive("é"), derive(""));
    }

    #[test]
    fn signer_key_material_cache_reuses_the_same_hd_path() {
        let root = master_xpriv(MNEMONIC).unwrap();
        let secp = Secp256k1::new();
        let mut cache = HashMap::new();

        let first = signer_key_material(&mut cache, &root, "m/84'/0'/0'/0/0", &secp).unwrap();
        let repeated = signer_key_material(&mut cache, &root, "m/84'/0'/0'/0/0", &secp).unwrap();

        assert_eq!(cache.len(), 1);
        assert_eq!(first.secret_key, repeated.secret_key);
        assert_eq!(first.public_key, repeated.public_key);

        signer_key_material(&mut cache, &root, "m/84'/0'/0'/0/1", &secp).unwrap();
        assert_eq!(cache.len(), 2);
    }

    fn unsigned_spend(outpoint: OutPoint, script_pubkey: ScriptBuf) -> Transaction {
        Transaction {
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
                script_pubkey,
            }],
        }
    }

    fn sign_test_psbt(
        psbt: &Psbt,
        outpoint: OutPoint,
        path: &str,
        script_type: &str,
    ) -> Result<Value, CryptoError> {
        sign_psbt(
            &json!({
                "mnemonic": MNEMONIC,
                "psbtBase64": BASE64.encode(psbt.serialize()),
                "signers": [{
                    "txid": outpoint.txid.to_string(),
                    "vout": outpoint.vout,
                    "path": path,
                    "scriptType": script_type
                }]
            })
            .to_string(),
        )
    }

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
    fn bip39_passphrase_matches_the_official_seed_vector() {
        let parsed = Mnemonic::parse_in_normalized(Language::English, MNEMONIC).unwrap();
        let mut seed = parsed.to_seed_normalized("TREZOR");
        assert_eq!(
            hex::encode(seed),
            "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e5349553\
             1f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04"
        );
        seed.zeroize();
    }

    #[test]
    fn random_bytes_respects_requested_length_and_changes_between_calls() {
        let request = json!({ "length": 32 }).to_string();
        let first = random_bytes(&request).unwrap();
        let second = random_bytes(&request).unwrap();
        let first = BASE64
            .decode(first.get("bytesBase64").and_then(Value::as_str).unwrap())
            .unwrap();
        let second = BASE64
            .decode(second.get("bytesBase64").and_then(Value::as_str).unwrap())
            .unwrap();

        assert_eq!(first.len(), 32);
        assert_eq!(second.len(), 32);
        assert_ne!(first, second);
    }

    #[test]
    fn random_bytes_rejects_out_of_policy_lengths() {
        for length in [0, MIN_RANDOM_BYTES - 1, MAX_RANDOM_BYTES + 1] {
            let error = random_bytes(&json!({ "length": length }).to_string()).unwrap_err();
            assert!(matches!(error, CryptoError::InvalidRequest(_)));
        }
    }

    #[test]
    fn entropy_source_failure_is_explicit_without_fallback() {
        let mut bytes = [0x5a; SEED_ENTROPY_BYTES];
        let result = fill_random_with(&mut bytes, |buffer| {
            buffer[..4].copy_from_slice(&[1, 2, 3, 4]);
            Err::<(), ()>(())
        });

        assert!(matches!(result, Err(CryptoError::Entropy)));
        assert_eq!(bytes, [0_u8; SEED_ENTROPY_BYTES]);
        assert_eq!(CryptoError::Entropy.code(), "ENTROPY_UNAVAILABLE");

        let mut unchanged_zero_buffer = [0_u8; SEED_ENTROPY_BYTES];
        let result = fill_random_with(&mut unchanged_zero_buffer, |_| Ok::<(), ()>(()));
        assert!(matches!(result, Err(CryptoError::Entropy)));
    }

    fn generated_mnemonic(response: &Value) -> &str {
        response.get("mnemonic").and_then(Value::as_str).unwrap()
    }

    fn assert_valid_24_word_mnemonic(mnemonic: &str) {
        assert_eq!(mnemonic.split_whitespace().count(), 24);
        assert!(Mnemonic::parse_in_normalized(Language::English, mnemonic).is_ok());
    }

    #[test]
    fn generated_mnemonic_accepts_absent_zero_and_arbitrary_additional_entropy() {
        let zero_entropy = BASE64.encode([0_u8; SEED_ENTROPY_BYTES]);
        let arbitrary_entropy_bytes: [u8; SEED_ENTROPY_BYTES] =
            std::array::from_fn(|index| index as u8);
        let arbitrary_entropy = BASE64.encode(arbitrary_entropy_bytes);
        let requests = [
            json!({}),
            json!({ "additionalEntropyBase64": zero_entropy }),
            json!({ "additionalEntropyBase64": arbitrary_entropy }),
        ];

        for request in requests {
            let first = generate_mnemonic(&request.to_string()).unwrap();
            let second = generate_mnemonic(&request.to_string()).unwrap();
            assert_valid_24_word_mnemonic(generated_mnemonic(&first));
            assert_valid_24_word_mnemonic(generated_mnemonic(&second));
            assert_ne!(generated_mnemonic(&first), generated_mnemonic(&second));
        }
    }

    #[test]
    fn different_additional_entropy_produces_different_mnemonics_without_returning_entropy() {
        let first = generate_mnemonic(
            &json!({ "additionalEntropyBase64": BASE64.encode([0x11; SEED_ENTROPY_BYTES]) })
                .to_string(),
        )
        .unwrap();
        let second = generate_mnemonic(
            &json!({ "additionalEntropyBase64": BASE64.encode([0x22; SEED_ENTROPY_BYTES]) })
                .to_string(),
        )
        .unwrap();

        assert_ne!(generated_mnemonic(&first), generated_mnemonic(&second));
        assert_eq!(first.as_object().unwrap().len(), 1);
        assert_eq!(second.as_object().unwrap().len(), 1);
    }

    #[test]
    fn generated_mnemonic_rejects_malformed_additional_entropy() {
        for request in [
            json!({ "additionalEntropyBase64": "not base64" }),
            json!({ "additionalEntropyBase64": BASE64.encode([0_u8; SEED_ENTROPY_BYTES - 1]) }),
            json!({ "additionalEntropyBase64": BASE64.encode([0_u8; SEED_ENTROPY_BYTES + 1]) }),
        ] {
            let error = generate_mnemonic(&request.to_string()).unwrap_err();
            assert!(matches!(error, CryptoError::InvalidRequest(_)));
        }
    }

    #[test]
    fn seed_entropy_is_the_exact_xor_of_system_and_additional_entropy() {
        let system_entropy: [u8; SEED_ENTROPY_BYTES] =
            std::array::from_fn(|index| (index as u8).wrapping_add(1));
        let additional_entropy: [u8; SEED_ENTROPY_BYTES] =
            std::array::from_fn(|index| 0xf0_u8.wrapping_sub(index as u8));
        let expected: [u8; SEED_ENTROPY_BYTES] =
            std::array::from_fn(|index| system_entropy[index] ^ additional_entropy[index]);

        let mixed = mix_seed_entropy_with(&additional_entropy, |buffer| {
            buffer.copy_from_slice(&system_entropy);
            Ok::<(), ()>(())
        })
        .unwrap();

        assert_eq!(&*mixed, &expected);

        let invalid =
            mix_seed_entropy_with(&[0_u8; SEED_ENTROPY_BYTES - 1], |_| -> Result<(), ()> {
                panic!("invalid additional entropy must be rejected before drawing randomness")
            });
        assert!(matches!(invalid, Err(CryptoError::InvalidRequest(_))));
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
        assert_valid_signatures(&signed);
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
        assert_valid_signatures(&signed);
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
        assert_valid_signatures(&signed);
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
        assert_valid_signatures(&signed);
    }

    #[test]
    fn rejects_a_witness_prevout_not_owned_by_the_derived_key() {
        let root = master_xpriv(MNEMONIC).unwrap();
        let secp = Secp256k1::new();
        let expected_secret = derive_secret(&root, "m/84'/0'/0'/0/0").unwrap();
        let expected_public = PublicKey::new(bitcoin::secp256k1::PublicKey::from_secret_key(
            &secp,
            &expected_secret,
        ));
        let other_secret = derive_secret(&root, "m/84'/0'/0'/0/1").unwrap();
        let other_public = PublicKey::new(bitcoin::secp256k1::PublicKey::from_secret_key(
            &secp,
            &other_secret,
        ));
        let expected_script = ScriptBuf::new_p2wpkh(&expected_public.wpubkey_hash().unwrap());
        let other_script = ScriptBuf::new_p2wpkh(&other_public.wpubkey_hash().unwrap());
        let outpoint = OutPoint::new(Txid::from_byte_array([0x44; 32]), 0);
        let mut psbt = Psbt::from_unsigned_tx(unsigned_spend(outpoint, expected_script)).unwrap();
        psbt.inputs[0].witness_utxo = Some(TxOut {
            value: Amount::from_sat(100_000),
            script_pubkey: other_script,
        });

        let error = sign_test_psbt(&psbt, outpoint, "m/84'/0'/0'/0/0", "p2wpkh").unwrap_err();
        assert!(matches!(error, CryptoError::InvalidPsbt(_)));
    }

    #[test]
    fn rejects_a_nested_witness_redeem_script_not_owned_by_the_derived_key() {
        let root = master_xpriv(MNEMONIC).unwrap();
        let secp = Secp256k1::new();
        let expected_secret = derive_secret(&root, "m/49'/0'/0'/0/0").unwrap();
        let expected_public = PublicKey::new(bitcoin::secp256k1::PublicKey::from_secret_key(
            &secp,
            &expected_secret,
        ));
        let expected_redeem = ScriptBuf::new_p2wpkh(&expected_public.wpubkey_hash().unwrap());
        let expected_script = ScriptBuf::new_p2sh(&expected_redeem.script_hash());
        let other_secret = derive_secret(&root, "m/49'/0'/0'/0/1").unwrap();
        let other_public = PublicKey::new(bitcoin::secp256k1::PublicKey::from_secret_key(
            &secp,
            &other_secret,
        ));
        let outpoint = OutPoint::new(Txid::from_byte_array([0x55; 32]), 0);
        let mut psbt =
            Psbt::from_unsigned_tx(unsigned_spend(outpoint, expected_script.clone())).unwrap();
        psbt.inputs[0].witness_utxo = Some(TxOut {
            value: Amount::from_sat(100_000),
            script_pubkey: expected_script,
        });
        psbt.inputs[0].redeem_script =
            Some(ScriptBuf::new_p2wpkh(&other_public.wpubkey_hash().unwrap()));

        let error = sign_test_psbt(&psbt, outpoint, "m/49'/0'/0'/0/0", "p2sh-p2wpkh").unwrap_err();
        assert!(matches!(error, CryptoError::InvalidPsbt(_)));
    }

    #[test]
    fn rejects_a_taproot_internal_key_not_owned_by_the_derived_key() {
        let root = master_xpriv(MNEMONIC).unwrap();
        let secp = Secp256k1::new();
        let expected_secret = derive_secret(&root, "m/86'/0'/0'/0/0").unwrap();
        let expected_keypair = Keypair::from_secret_key(&secp, &expected_secret);
        let (expected_internal_key, _) = expected_keypair.x_only_public_key();
        let expected_script = ScriptBuf::new_p2tr(&secp, expected_internal_key, None);
        let other_secret = derive_secret(&root, "m/86'/0'/0'/0/1").unwrap();
        let other_keypair = Keypair::from_secret_key(&secp, &other_secret);
        let (other_internal_key, _) = other_keypair.x_only_public_key();
        let outpoint = OutPoint::new(Txid::from_byte_array([0x66; 32]), 0);
        let mut psbt =
            Psbt::from_unsigned_tx(unsigned_spend(outpoint, expected_script.clone())).unwrap();
        psbt.inputs[0].witness_utxo = Some(TxOut {
            value: Amount::from_sat(100_000),
            script_pubkey: expected_script,
        });
        psbt.inputs[0].tap_internal_key = Some(other_internal_key);

        let error = sign_test_psbt(&psbt, outpoint, "m/86'/0'/0'/0/0", "p2tr").unwrap_err();
        assert!(matches!(error, CryptoError::InvalidPsbt(_)));
    }

    #[test]
    fn rejects_a_legacy_parent_transaction_with_a_different_txid() {
        let root = master_xpriv(MNEMONIC).unwrap();
        let secp = Secp256k1::new();
        let secret_key = derive_secret(&root, "m/44'/0'/0'/0/0").unwrap();
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
        let outpoint = OutPoint::new(Txid::from_byte_array([0x77; 32]), 0);
        assert_ne!(previous.compute_txid(), outpoint.txid);
        let mut psbt = Psbt::from_unsigned_tx(unsigned_spend(outpoint, script)).unwrap();
        psbt.inputs[0].non_witness_utxo = Some(previous);

        let error = sign_test_psbt(&psbt, outpoint, "m/44'/0'/0'/0/0", "p2pkh").unwrap_err();
        assert!(matches!(error, CryptoError::InvalidPsbt(_)));
    }
}
