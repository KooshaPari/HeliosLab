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
pub extern "C" fn pheno_db_open(path: *const c_char) -> *mut Database {
    let p = cstr_to_str(path);
    match Database::open(&PathBuf::from(p)) {
        Ok(db) => Box::into_raw(Box::new(db)),
        Err(_) => ptr::null_mut(),
    }
}

/// Close and free a database handle.
#[no_mangle]
pub extern "C" fn pheno_db_close(db: *mut Database) {
    if !db.is_null() {
        unsafe { drop(Box::from_raw(db)) };
    }
}

/// Free a string returned by any pheno_* function.
#[no_mangle]
pub extern "C" fn pheno_string_free(s: *mut c_char) {
    if !s.is_null() {
        unsafe { drop(CString::from_raw(s)) };
    }
}

/// List flags as JSON array. Caller must free returned string.
#[no_mangle]
pub extern "C" fn pheno_flag_list(db: *const Database) -> *mut c_char {
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
pub extern "C" fn pheno_flag_enable(db: *const Database, name: *const c_char) -> i32 {
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
pub extern "C" fn pheno_flag_disable(db: *const Database, name: *const c_char) -> i32 {
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
pub extern "C" fn pheno_config_get(db: *const Database, key: *const c_char) -> *mut c_char {
    let db = unsafe { &*db };
    let key = cstr_to_str(key);
    match db.get_config(NS, key) {
        Ok(entry) => to_cstring(&entry.value),
        Err(_) => ptr::null_mut(),
    }
}

/// Set a config value. Returns 0 on success, -1 on error.
#[no_mangle]
pub extern "C" fn pheno_config_set(
    db: *const Database,
    key: *const c_char,
    value: *const c_char,
) -> i32 {
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
pub extern "C" fn pheno_secret_set(
    db: *const Database,
    key: *const c_char,
    plaintext: *const c_char,
    hex_key: *const c_char,
) -> i32 {
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
pub extern "C" fn pheno_secret_get(
    db: *const Database,
    key: *const c_char,
    hex_key: *const c_char,
) -> *mut c_char {
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
pub extern "C" fn pheno_version_show(db: *const Database) -> *mut c_char {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_db() -> (TempDir, String) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.db");
        (dir, path.to_string_lossy().to_string())
    }

    fn cleanup_cstring(s: *mut c_char) {
        unsafe { pheno_string_free(s) };
    }

    // Traces to: FR-HELIOS-FFI-GO-001 (db open/close lifecycle)
    #[test]
    fn test_pheno_db_open_close() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());
        assert!(!db.is_null());
        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-002 (db open with invalid path)
    #[test]
    fn test_pheno_db_open_invalid_path() {
        let db = pheno_db_open(CString::new("/nonexistent/path/db").unwrap().as_ptr());
        assert!(db.is_null());
    }

    // Traces to: FR-HELIOS-FFI-GO-003 (db open with null path)
    #[test]
    fn test_pheno_db_open_null_path() {
        let db = pheno_db_open(std::ptr::null());
        assert!(!db.is_null()); // defaults to empty string path
        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-004 (string free null safety)
    #[test]
    fn test_pheno_string_free_null_safety() {
        pheno_string_free(std::ptr::null_mut()); // should not panic
    }

    // Traces to: FR-HELIOS-FFI-GO-005 (flag list empty)
    #[test]
    fn test_pheno_flag_list_empty() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());
        assert!(!db.is_null());

        let result = pheno_flag_list(db);
        assert!(!result.is_null());

        let json_str = unsafe { CStr::from_ptr(result).to_str().unwrap() };
        assert_eq!(json_str, "[]");

        cleanup_cstring(result);
        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-006 (flag enable)
    #[test]
    fn test_pheno_flag_enable() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let name = CString::new("test_flag").unwrap();
        let ret = pheno_flag_enable(db, name.as_ptr());
        assert_eq!(ret, 0); // success

        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-007 (flag disable existing)
    #[test]
    fn test_pheno_flag_disable_existing() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let name = CString::new("disable_flag").unwrap();
        pheno_flag_enable(db, name.as_ptr());
        let ret = pheno_flag_disable(db, name.as_ptr());
        assert_eq!(ret, 0);

        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-008 (flag disable missing returns error)
    #[test]
    fn test_pheno_flag_disable_missing() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let name = CString::new("nonexistent_flag").unwrap();
        let ret = pheno_flag_disable(db, name.as_ptr());
        assert_eq!(ret, -1); // error

        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-009 (config get/set)
    #[test]
    fn test_pheno_config_get_set() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let key = CString::new("config_key").unwrap();
        let value = CString::new("config_value").unwrap();

        let ret = pheno_config_set(db, key.as_ptr(), value.as_ptr());
        assert_eq!(ret, 0);

        let result = pheno_config_get(db, key.as_ptr());
        assert!(!result.is_null());

        let retrieved = unsafe { CStr::from_ptr(result).to_str().unwrap() };
        assert_eq!(retrieved, "config_value");

        cleanup_cstring(result);
        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-010 (config get missing returns null)
    #[test]
    fn test_pheno_config_get_missing() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let key = CString::new("missing_key").unwrap();
        let result = pheno_config_get(db, key.as_ptr());
        assert!(result.is_null());

        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-011 (config set empty value)
    #[test]
    fn test_pheno_config_set_empty_value() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let key = CString::new("empty_key").unwrap();
        let value = CString::new("").unwrap();

        let ret = pheno_config_set(db, key.as_ptr(), value.as_ptr());
        assert_eq!(ret, 0);

        let result = pheno_config_get(db, key.as_ptr());
        let retrieved = unsafe { CStr::from_ptr(result).to_str().unwrap() };
        assert_eq!(retrieved, "");

        cleanup_cstring(result);
        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-012 (secret set/get with valid key)
    #[test]
    fn test_pheno_secret_set_get_valid_key() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let key = CString::new("secret_key").unwrap();
        let plaintext = CString::new("secret_value").unwrap();
        let hex_key = CString::new("0".repeat(64)).unwrap(); // 32 bytes in hex

        let ret = pheno_secret_set(db, key.as_ptr(), plaintext.as_ptr(), hex_key.as_ptr());
        assert_eq!(ret, 0);

        let result = pheno_secret_get(db, key.as_ptr(), hex_key.as_ptr());
        assert!(!result.is_null());

        let decrypted = unsafe { CStr::from_ptr(result).to_str().unwrap() };
        assert_eq!(decrypted, "secret_value");

        cleanup_cstring(result);
        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-013 (secret with invalid hex key)
    #[test]
    fn test_pheno_secret_invalid_hex_key() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let key = CString::new("secret_key").unwrap();
        let plaintext = CString::new("secret_value").unwrap();
        let hex_key = CString::new("ZZZZ").unwrap(); // invalid hex

        let ret = pheno_secret_set(db, key.as_ptr(), plaintext.as_ptr(), hex_key.as_ptr());
        assert_eq!(ret, -1);

        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-014 (secret with short key)
    #[test]
    fn test_pheno_secret_short_key() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let key = CString::new("secret_key").unwrap();
        let plaintext = CString::new("secret_value").unwrap();
        let hex_key = CString::new("0".repeat(32)).unwrap(); // 16 bytes (too short)

        let ret = pheno_secret_set(db, key.as_ptr(), plaintext.as_ptr(), hex_key.as_ptr());
        assert_eq!(ret, -1);

        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-015 (secret get missing returns null)
    #[test]
    fn test_pheno_secret_get_missing() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let key = CString::new("missing_secret").unwrap();
        let hex_key = CString::new("0".repeat(64)).unwrap();

        let result = pheno_secret_get(db, key.as_ptr(), hex_key.as_ptr());
        assert!(result.is_null());

        pheno_db_close(db);
    }

    // Traces to: FR-HELIOS-FFI-GO-016 (version show empty)
    #[test]
    fn test_pheno_version_show_empty() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let result = pheno_version_show(db);
        assert!(!result.is_null());

        let json_str = unsafe { CStr::from_ptr(result).to_str().unwrap() };
        assert_eq!(json_str, "[]");

        cleanup_cstring(result);
        pheno_db_close(db);
    }


    // Traces to: FR-HELIOS-FFI-GO-018 (flag enable with empty name)
    #[test]
    fn test_pheno_flag_enable_empty_name() {
        let (_dir, db_path) = create_test_db();
        let db = pheno_db_open(CString::new(db_path).unwrap().as_ptr());

        let name = CString::new("").unwrap();
        let ret = pheno_flag_enable(db, name.as_ptr());
        assert_eq!(ret, 0); // should succeed (empty flag name allowed)

        pheno_db_close(db);
    }
}
