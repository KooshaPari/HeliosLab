use chrono::Utc;
use pheno_core::*;
use pheno_db::Database;
use pyo3::exceptions::PyRuntimeError;
use pyo3::prelude::*;
use std::path::PathBuf;
use std::sync::Mutex;

type AuditRecord = (i64, Option<String>, String, String, String);

fn to_pyerr(e: pheno_core::Error) -> PyErr {
    PyRuntimeError::new_err(e.to_string())
}

struct Db(Mutex<Database>);

impl Db {
    fn lock(&self) -> std::sync::MutexGuard<'_, Database> {
        self.0.lock().unwrap()
    }
}

fn open_db(path: &str) -> PyResult<Database> {
    let p = PathBuf::from(path);
    Database::open(&p).map_err(to_pyerr)
}

#[pyclass]
struct PhenoConfig {
    db: Db,
    namespace: String,
}

#[pymethods]
impl PhenoConfig {
    #[new]
    #[pyo3(signature = (db_path, namespace = "default".to_string()))]
    fn new(db_path: String, namespace: String) -> PyResult<Self> {
        let db = open_db(&db_path)?;
        Ok(Self {
            db: Db(Mutex::new(db)),
            namespace,
        })
    }

    fn get(&self, key: String) -> PyResult<(String, String, String)> {
        let entry = self.db.lock().get_config(&self.namespace, &key).map_err(to_pyerr)?;
        Ok((entry.key, entry.value, entry.value_type.to_string()))
    }

    #[pyo3(signature = (key, value, value_type = "string".to_string()))]
    fn set(&self, key: String, value: String, value_type: String) -> PyResult<()> {
        let vt: ValueType = value_type.parse().map_err(to_pyerr)?;
        let entry = ConfigEntry {
            key,
            value,
            value_type: vt,
            namespace: self.namespace.clone(),
            updated_at: Utc::now(),
            updated_by: std::env::var("USER").unwrap_or_else(|_| "python".to_string()),
        };
        self.db.lock().set_config(&entry).map_err(to_pyerr)
    }

    fn list(&self) -> PyResult<Vec<(String, String, String)>> {
        let entries = self.db.lock().list_config(&self.namespace).map_err(to_pyerr)?;
        Ok(entries.iter().map(|e| (e.key.clone(), e.value.clone(), e.value_type.to_string())).collect())
    }

    fn delete(&self, key: String) -> PyResult<()> {
        self.db.lock().delete_config(&self.namespace, &key).map_err(to_pyerr)
    }

    fn audit(&self, key: String) -> PyResult<Vec<AuditRecord>> {
        let records = self.db.lock().audit_log(&self.namespace, &key).map_err(to_pyerr)?;
        Ok(records
            .iter()
            .map(|r| {
                (
                    r.id,
                    r.old_value.clone(),
                    r.new_value.clone(),
                    r.changed_by.clone(),
                    r.changed_at.to_rfc3339(),
                )
            })
            .collect())
    }

    fn restore(&self, key: String, audit_id: i64) -> PyResult<(String, String)> {
        let entry = self.db.lock().restore_config(&self.namespace, &key, audit_id).map_err(to_pyerr)?;
        Ok((entry.key, entry.value))
    }
}

#[pyclass]
struct FeatureFlags {
    db: Db,
    namespace: String,
}

#[pymethods]
impl FeatureFlags {
    #[new]
    #[pyo3(signature = (db_path, namespace = "default".to_string()))]
    fn new(db_path: String, namespace: String) -> PyResult<Self> {
        let db = open_db(&db_path)?;
        Ok(Self {
            db: Db(Mutex::new(db)),
            namespace,
        })
    }

    fn list(&self) -> PyResult<Vec<(String, bool, String)>> {
        let flags = self.db.lock().list_flags(&self.namespace).map_err(to_pyerr)?;
        Ok(flags.iter().map(|f| (f.name.clone(), f.enabled, f.description.clone())).collect())
    }

    #[pyo3(signature = (name, description = "".to_string()))]
    fn create(&self, name: String, description: String) -> PyResult<()> {
        let flag = FeatureFlag {
            name,
            enabled: false,
            namespace: self.namespace.clone(),
            description,
            updated_at: Utc::now(),
            stage: "SP".to_string(),
            transience_class: "F".to_string(),
            channel: vec!["dev".to_string()],
            retire_at_stage: None,
        };
        self.db.lock().set_flag(&flag).map_err(to_pyerr)
    }

    fn enable(&self, name: String) -> PyResult<()> {
        let db = self.db.lock();
        let mut flag = db.get_flag(&self.namespace, &name).unwrap_or(FeatureFlag {
            name,
            enabled: false,
            namespace: self.namespace.clone(),
            description: String::new(),
            updated_at: Utc::now(),
            stage: "SP".to_string(),
            transience_class: "F".to_string(),
            channel: vec!["dev".to_string()],
            retire_at_stage: None,
        });
        flag.enabled = true;
        flag.updated_at = Utc::now();
        db.set_flag(&flag).map_err(to_pyerr)
    }

    fn disable(&self, name: String) -> PyResult<()> {
        let db = self.db.lock();
        let mut flag = db.get_flag(&self.namespace, &name).map_err(to_pyerr)?;
        flag.enabled = false;
        flag.updated_at = Utc::now();
        db.set_flag(&flag).map_err(to_pyerr)
    }

    fn delete(&self, name: String) -> PyResult<()> {
        self.db.lock().delete_flag(&self.namespace, &name).map_err(to_pyerr)
    }
}

#[pyclass]
struct Secrets {
    db: Db,
    encryption_key: Vec<u8>,
}

#[pymethods]
impl Secrets {
    #[new]
    fn new(db_path: String, hex_key: String) -> PyResult<Self> {
        let db = open_db(&db_path)?;
        let encryption_key =
            hex::decode(&hex_key).map_err(|e| PyRuntimeError::new_err(format!("invalid hex key: {e}")))?;
        if encryption_key.len() != 32 {
            return Err(PyRuntimeError::new_err("key must be 32 bytes (64 hex chars)"));
        }
        Ok(Self {
            db: Db(Mutex::new(db)),
            encryption_key,
        })
    }

    fn set(&self, key: String, plaintext: String) -> PyResult<()> {
        let (ciphertext, nonce) =
            pheno_crypto::encrypt(plaintext.as_bytes(), &self.encryption_key).map_err(to_pyerr)?;
        let entry = SecretEntry {
            key,
            encrypted_value: ciphertext,
            nonce,
            updated_at: Utc::now(),
        };
        self.db.lock().set_secret(&entry).map_err(to_pyerr)
    }

    fn get(&self, key: String) -> PyResult<String> {
        let entry = self.db.lock().get_secret(&key).map_err(to_pyerr)?;
        let plaintext =
            pheno_crypto::decrypt(&entry.encrypted_value, &entry.nonce, &self.encryption_key)
                .map_err(to_pyerr)?;
        String::from_utf8(plaintext).map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    fn list(&self) -> PyResult<Vec<String>> {
        self.db.lock().list_secrets().map_err(to_pyerr)
    }

    fn delete(&self, key: String) -> PyResult<()> {
        self.db.lock().delete_secret(&key).map_err(to_pyerr)
    }
}

#[pyclass]
#[allow(dead_code)]
struct VersionInfoPy {
    db: Db,
}

#[pymethods]
impl VersionInfoPy {
    #[new]
    fn new(db_path: String) -> PyResult<Self> {
        let db = open_db(&db_path)?;
        Ok(Self {
            db: Db(Mutex::new(db)),
        })
    }

    fn show(&self) -> PyResult<Vec<(String, String, String, String)>> {
        let versions = self.db.lock().list_versions().map_err(to_pyerr)?;
        Ok(versions
            .iter()
            .map(|v| {
                (
                    v.repo.clone(),
                    v.our_version.clone(),
                    v.upstream_version.clone(),
                    v.synced_at.to_rfc3339(),
                )
            })
            .collect())
    }

    fn bump(&self, repo: String, version: String) -> PyResult<()> {
        let db = self.db.lock();
        let mut info = db.get_version(&repo).unwrap_or(pheno_core::VersionInfo {
            repo: repo.clone(),
            our_version: "0.0.0".to_string(),
            upstream_version: String::new(),
            synced_at: Utc::now(),
        });
        info.our_version = version;
        info.synced_at = Utc::now();
        db.set_version(&info).map_err(to_pyerr)
    }

    fn sync(&self, repo: String, upstream: String) -> PyResult<()> {
        let db = self.db.lock();
        let mut info = db.get_version(&repo).unwrap_or(pheno_core::VersionInfo {
            repo: repo.clone(),
            our_version: "0.0.0".to_string(),
            upstream_version: String::new(),
            synced_at: Utc::now(),
        });
        info.upstream_version = upstream;
        info.synced_at = Utc::now();
        db.set_version(&info).map_err(to_pyerr)
    }
}

#[pymodule]
fn phenotype_config(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PhenoConfig>()?;
    m.add_class::<FeatureFlags>()?;
    m.add_class::<Secrets>()?;
    m.add_class::<VersionInfoPy>()?;
    Ok(())
}
