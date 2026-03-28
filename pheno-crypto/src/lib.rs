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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_key_produces_32_bytes() {
        // Traces to: FR-CRYPTO-001
        let key = generate_key();
        assert_eq!(key.len(), 32, "AES-256-GCM key must be exactly 32 bytes");
    }

    #[test]
    fn test_generate_key_produces_unique_keys() {
        // Traces to: FR-CRYPTO-001
        let key1 = generate_key();
        let key2 = generate_key();
        assert_ne!(key1, key2, "Two generated keys should not be identical");
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        // Traces to: FR-CRYPTO-002
        let key = generate_key();
        let plaintext = b"hello, colab secrets!";
        let (ciphertext, nonce) = encrypt(plaintext, &key).expect("encrypt should succeed");
        let decrypted = decrypt(&ciphertext, &nonce, &key).expect("decrypt should succeed");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_produces_different_ciphertext_each_time() {
        // Traces to: FR-CRYPTO-002 (nonce is randomized)
        let key = generate_key();
        let plaintext = b"same plaintext";
        let (ct1, _) = encrypt(plaintext, &key).unwrap();
        let (ct2, _) = encrypt(plaintext, &key).unwrap();
        assert_ne!(ct1, ct2, "Ciphertext should differ between encryptions due to random nonce");
    }

    #[test]
    fn test_decrypt_fails_with_wrong_key() {
        // Traces to: FR-CRYPTO-003
        let key = generate_key();
        let wrong_key = generate_key();
        let plaintext = b"sensitive data";
        let (ciphertext, nonce) = encrypt(plaintext, &key).unwrap();
        let result = decrypt(&ciphertext, &nonce, &wrong_key);
        assert!(result.is_err(), "Decryption with wrong key must fail");
    }

    #[test]
    fn test_decrypt_fails_with_tampered_ciphertext() {
        // Traces to: FR-CRYPTO-003
        let key = generate_key();
        let plaintext = b"important config value";
        let (mut ciphertext, nonce) = encrypt(plaintext, &key).unwrap();
        ciphertext[0] ^= 0xFF; // flip bits in first byte
        let result = decrypt(&ciphertext, &nonce, &key);
        assert!(result.is_err(), "Decryption of tampered ciphertext must fail");
    }

    #[test]
    fn test_decrypt_fails_with_wrong_nonce() {
        // Traces to: FR-CRYPTO-003
        let key = generate_key();
        let plaintext = b"secret value";
        let (ciphertext, mut nonce) = encrypt(plaintext, &key).unwrap();
        nonce[0] ^= 0x01; // flip one bit in nonce
        let result = decrypt(&ciphertext, &nonce, &key);
        assert!(result.is_err(), "Decryption with wrong nonce must fail");
    }

    #[test]
    fn test_encrypt_empty_plaintext() {
        // Traces to: FR-CRYPTO-002
        let key = generate_key();
        let (ciphertext, nonce) = encrypt(b"", &key).expect("should encrypt empty plaintext");
        let decrypted = decrypt(&ciphertext, &nonce, &key).expect("should decrypt empty ciphertext");
        assert_eq!(decrypted, b"");
    }

    #[test]
    fn test_load_key_from_env_missing_var() {
        // Traces to: FR-CRYPTO-004
        // Ensure env var is not set
        std::env::remove_var("PHENO_SECRET_KEY");
        let result = load_key_from_env();
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("PHENO_SECRET_KEY"), "Error should mention the env var name");
    }

    #[test]
    fn test_load_key_from_env_invalid_hex() {
        // Traces to: FR-CRYPTO-004
        std::env::set_var("PHENO_SECRET_KEY", "not-valid-hex!!!");
        let result = load_key_from_env();
        std::env::remove_var("PHENO_SECRET_KEY");
        assert!(result.is_err());
    }

    #[test]
    fn test_load_key_from_env_valid_hex() {
        // Traces to: FR-CRYPTO-004
        let key = generate_key();
        let hex_key = hex::encode(&key);
        std::env::set_var("PHENO_SECRET_KEY", &hex_key);
        let loaded = load_key_from_env().expect("should load key from valid hex");
        std::env::remove_var("PHENO_SECRET_KEY");
        assert_eq!(loaded, key);
    }
}
