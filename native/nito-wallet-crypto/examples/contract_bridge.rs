//! Desktop integration-test transport. Calls the same C ABI as the mobile bridge.
//! This executable is not part of the Android or iOS application.
use nito_wallet_crypto::{nito_wallet_crypto_free, nito_wallet_crypto_invoke};
use serde::Deserialize;
use std::ffi::{CStr, CString};
use std::io::{self, Read, Write};

#[derive(Deserialize)]
struct Call {
    operation: String,
    request: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let call: Call = serde_json::from_str(&input)?;
    let operation = CString::new(call.operation)?;
    let request = CString::new(call.request)?;
    // SAFETY: both input strings outlive the call. Copy the returned string, then
    // free it exactly once before any fallible output operation.
    let result = unsafe { nito_wallet_crypto_invoke(operation.as_ptr(), request.as_ptr()) };
    if result.is_null() {
        return Err("Native bridge returned a null pointer".into());
    }
    let bytes = unsafe { CStr::from_ptr(result).to_bytes().to_owned() };
    unsafe { nito_wallet_crypto_free(result) };
    io::stdout().write_all(&bytes)?;
    Ok(())
}
