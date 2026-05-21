#![expect(clippy::missing_safety_doc)]

use chrono::Utc;
use pheno_core::*;
use pheno_db::Database;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::path::PathBuf;
use std::ptr;

const NS: &str = "default";

fn cstr_to_str<'a>(s: *const c_char) -> &'a str {
    if s.is_null() {
        return "";
    }
    unsafe { CStr::from_ptr(s) }.to_str().unwrap_or("")
}

fn to_cstring(s: &str) -> *mut c_char {
    CString::new(s).unwrap_or_default().into_raw()
}

/// Open a database. Returns an opaque handle. Caller must call `pheno_db_close` when done.
#[no_mangle]
pub unsafe extern "C" fn pheno_db_open(path: *const c_char) -> *mut Database {
    // SAFETY: `path` must be a valid, null-terminated C string borrowed from Go.
    // The returned pointer must be freed by the caller via `pheno_db_close`.
    let p = cstr_to_str(path);
    match Database::open(&PathBuf::from(p)) {
        Ok(db) => Box::into_raw(Box::new(db)),
        Err(_) => ptr::null_mut(),
    }
}

/// Close and free a database handle.
#[no_mangle]
pub unsafe extern "C" fn pheno_db_close(db: *mut Database) {
    // SAFETY: `db` must be a valid pointer returned by `pheno_db_open` and must not be used after this call.
    if !db.is_null() {
        drop(Box::from_raw(db));
    }
}

/// Free a string returned by any pheno_* function.
#[no_mangle]
pub unsafe extern "C" fn pheno_string_free(s: *mut c_char) {
    // SAFETY: `s` must be a valid pointer returned by any pheno_* function and must not be used after this call.
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// List flags as JSON array. Caller must free returned string.
#[no_mangle]
pub unsafe extern "C" fn pheno_flag_list(db: *const Database) -> *mut c_char {
    // SAFETY: `db` must be a valid, non-null pointer returned by `pheno_db_open` and must not be used after `pheno_db_close`.
    let db = unsafe { &*db };
    match db.list_flags(NS) {
        Ok(flags) => {
            let items: Vec<String> = flags
                .iter()
                .map(|f| {
                    format!(
                        r#"{{"name":"{}","enabled":{},"description":"{}"}}"#,
                        f.name, f.enabled, f.description
                    )
                })
                .collect();
            to_cstring(&format!("[{}]", items.join(",")))
        }
        Err(_) => ptr::null_mut(),
    }
}

/// Enable a flag by name. Returns 0 on success, -1 on error.
#[no_mangle]
pub unsafe extern "C" fn pheno_flag_enable(db: *const Database, name: *const c_char) -> i32 {
    // SAFETY: `db` must be a valid, non-null pointer returned by `pheno_db_open` and must not be used after `pheno_db_close`.
    // `name` must be a valid, null-terminated C string.
    let db = unsafe { &*db };
    let name = cstr_to_str(name);
    let mut flag = db.get_flag(NS, name).unwrap_or(FeatureFlag {
        name: name.to_string(),
        enabled: false,
        namespace: NS.to_string(),
        description: String::new(),
        updated_at: Utc::now(),
        stage: "SP".to_string(),
        transience_class: "F".to_string(),
        channel: vec!["dev".to_string()],
        retire_at_stage: None,
    });
    flag.enabled = true;
    flag.updated_at = Utc::now();
    match db.set_flag(&flag) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

/// Disable a flag by name. Returns 0 on success, -1 on error.
#[no_mangle]
pub unsafe extern "C" fn pheno_flag_disable(db: *const Database, name: *const c_char) -> i32 {
    // SAFETY: `db` must be a valid, non-null pointer returned by `pheno_db_open` and must not be used after `pheno_db_close`.
    // `name` must be a valid, null-terminated C string.
    let db = unsafe { &*db };
    let name = cstr_to_str(name);
    let mut flag = match db.get_flag(NS, name) {
        Ok(f) => f,
        Err(_) => return -1,
    };
    flag.enabled = false;
    flag.updated_at = Utc::now();
    match db.set_flag(&flag) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

/// Get a config value. Caller must free returned string. Returns NULL if not found.
#[no_mangle]
pub unsafe extern "C" fn pheno_config_get(db: *const Database, key: *const c_char) -> *mut c_char {
    // SAFETY: `db` must be a valid, non-null pointer returned by `pheno_db_open` and must not be used after `pheno_db_close`.
    // `key` must be a valid, null-terminated C string.
    let db = unsafe { &*db };
    let key = cstr_to_str(key);
    match db.get_config(NS, key) {
        Ok(entry) => to_cstring(&entry.value),
        Err(_) => ptr::null_mut(),
    }
}

/// Set a config value. Returns 0 on success, -1 on error.
#[no_mangle]
pub unsafe extern "C" fn pheno_config_set(
    db: *const Database,
    key: *const c_char,
    value: *const c_char,
) -> i32 {
    // SAFETY: `db` must be a valid, non-null pointer returned by `pheno_db_open` and must not be used after `pheno_db_close`.
    // `key` and `value` must be valid, null-terminated C strings.
    let db = unsafe { &*db };
    let key = cstr_to_str(key);
    let value = cstr_to_str(value);
    let entry = ConfigEntry {
        key: key.to_string(),
        value: value.to_string(),
        value_type: ValueType::String,
        namespace: NS.to_string(),
        updated_at: Utc::now(),
        updated_by: "cgo".to_string(),
    };
    match db.set_config(&entry) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

/// Set an encrypted secret. Returns 0 on success, -1 on error.
#[no_mangle]
pub unsafe extern "C" fn pheno_secret_set(
    db: *const Database,
    key: *const c_char,
    plaintext: *const c_char,
    hex_key: *const c_char,
) -> i32 {
    // SAFETY: `db` must be a valid, non-null pointer returned by `pheno_db_open` and must not be used after `pheno_db_close`.
    // `key`, `plaintext`, and `hex_key` must be valid, null-terminated C strings.
    let db = unsafe { &*db };
    let key = cstr_to_str(key);
    let plaintext = cstr_to_str(plaintext);
    let hex_key = cstr_to_str(hex_key);
    let enc_key = match hex::decode(hex_key) {
        Ok(k) if k.len() == 32 => k,
        _ => return -1,
    };
    let (ciphertext, nonce) = match pheno_crypto::encrypt(plaintext.as_bytes(), &enc_key) {
        Ok(v) => v,
        Err(_) => return -1,
    };
    let entry = SecretEntry {
        key: key.to_string(),
        encrypted_value: ciphertext,
        nonce,
        updated_at: Utc::now(),
    };
    match db.set_secret(&entry) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

/// Get a decrypted secret. Caller must free returned string. Returns NULL on error.
#[no_mangle]
pub unsafe extern "C" fn pheno_secret_get(
    db: *const Database,
    key: *const c_char,
    hex_key: *const c_char,
) -> *mut c_char {
    // SAFETY: `db` must be a valid, non-null pointer returned by `pheno_db_open` and must not be used after `pheno_db_close`.
    // `key` and `hex_key` must be valid, null-terminated C strings.
    let db = unsafe { &*db };
    let key = cstr_to_str(key);
    let hex_key = cstr_to_str(hex_key);
    let enc_key = match hex::decode(hex_key) {
        Ok(k) if k.len() == 32 => k,
        _ => return ptr::null_mut(),
    };
    let entry = match db.get_secret(key) {
        Ok(e) => e,
        Err(_) => return ptr::null_mut(),
    };
    match pheno_crypto::decrypt(&entry.encrypted_value, &entry.nonce, &enc_key) {
        Ok(plain) => to_cstring(&String::from_utf8_lossy(&plain)),
        Err(_) => ptr::null_mut(),
    }
}

/// List versions as JSON array. Caller must free returned string.
#[no_mangle]
pub unsafe extern "C" fn pheno_version_show(db: *const Database) -> *mut c_char {
    // SAFETY: `db` must be a valid, non-null pointer returned by `pheno_db_open` and must not be used after `pheno_db_close`.
    let db = unsafe { &*db };
    match db.list_versions() {
        Ok(versions) => {
            let items: Vec<String> = versions
                .iter()
                .map(|v| {
                    format!(
                        r#"{{"repo":"{}","our_version":"{}","upstream_version":"{}","synced_at":"{}"}}"#,
                        v.repo, v.our_version, v.upstream_version, v.synced_at.to_rfc3339()
                    )
                })
                .collect();
            to_cstring(&format!("[{}]", items.join(",")))
        }
        Err(_) => ptr::null_mut(),
    }
}
