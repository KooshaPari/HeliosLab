use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, AeadCore, Key, Nonce};
use pheno_core::{Error, Result};

pub fn generate_key() -> Vec<u8> {
    use rand::RngCore;
    let mut key = vec![0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    key
}

pub fn load_key_from_env() -> Result<Vec<u8>> {
    let hex = std::env::var("PHENO_SECRET_KEY")
        .map_err(|_| Error::Crypto("PHENO_SECRET_KEY not set".into()))?;
    hex::decode(&hex).map_err(|e| Error::Crypto(format!("invalid hex key: {e}")))
}

pub fn encrypt(plaintext: &[u8], key: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| Error::Crypto(format!("encrypt failed: {e}")))?;
    Ok((ciphertext, nonce.to_vec()))
}

pub fn decrypt(ciphertext: &[u8], nonce_bytes: &[u8], key: &[u8]) -> Result<Vec<u8>> {
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| Error::Crypto(format!("decrypt failed: {e}")))
}
