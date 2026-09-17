use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

// ============================================================================
// Data types
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenUsage {
    pub session_id: String,
    pub prompt_tokens: i32,
    pub completion_tokens: i32,
    pub cost_cents: f64,
    pub backend: String,
    pub recorded_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenStats {
    pub session_id: String,
    pub total_prompt_tokens: i64,
    pub total_completion_tokens: i64,
    pub total_cost_cents: f64,
    pub usage_count: i64,
}

// ============================================================================
// Database initialization
// ============================================================================

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            model_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id),
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE TABLE IF NOT EXISTS token_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            cost_cents REAL NOT NULL DEFAULT 0.0,
            backend TEXT NOT NULL,
            recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_token_session ON token_usage(session_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content=messages, content_rowid=rowid);
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        END;"
    )?;
    Ok(())
}

// ============================================================================
// String marshalling helpers
// ============================================================================

/// Move a Rust `String` across the FFI boundary.
///
/// Interior NUL bytes would make `CString::new` fail and, on the old code path,
/// panic. Terminal output and pasted text can contain NULs, so they are
/// stripped rather than allowed to abort the process.
fn to_c_string(s: String) -> *mut c_char {
    let cleaned: String = s.replace('\0', "");
    CString::new(cleaned)
        .unwrap_or_else(|_| CString::new("[]").expect("literal has no NUL"))
        .into_raw()
}

/// Serialise `value` to JSON for the caller, falling back to `fallback` when
/// serialisation fails. The returned pointer must be released with
/// [`helios_db_free_string`].
fn to_json_cstring<T: Serialize>(value: &T, fallback: &str) -> *mut c_char {
    match serde_json::to_string(value) {
        Ok(json) => to_c_string(json),
        Err(_) => to_c_string(fallback.to_string()),
    }
}

// ============================================================================
// C ABI exports for Bun FFI
// ============================================================================

/// Open or create a database. Returns opaque pointer.
#[no_mangle]
pub extern "C" fn helios_db_open(path: *const c_char) -> *mut Connection {
    let c_path = unsafe { CStr::from_ptr(path) };
    let path_str = c_path.to_str().unwrap_or("/tmp/helioslab.db");

    match Connection::open(path_str) {
        Ok(conn) => {
            if init_db(&conn).is_err() {
                return std::ptr::null_mut();
            }
            Box::into_raw(Box::new(conn))
        }
        Err(_) => std::ptr::null_mut(),
    }
}

/// Create a conversation. Returns 0 on success, -1 on error.
#[no_mangle]
pub extern "C" fn helios_db_create_conversation(
    db: *mut Connection,
    id: *const c_char,
    title: *const c_char,
    model_id: *const c_char,
) -> i32 {
    let conn = unsafe { &*db };
    let id_str = unsafe { CStr::from_ptr(id).to_str().unwrap_or("") };
    let title_str = unsafe { CStr::from_ptr(title).to_str().unwrap_or("Untitled") };
    let model_str = unsafe { CStr::from_ptr(model_id).to_str().unwrap_or("unknown") };

    match conn.execute(
        "INSERT INTO conversations (id, title, model_id) VALUES (?1, ?2, ?3)",
        params![id_str, title_str, model_str],
    ) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

/// Add a message to a conversation. Returns 0 on success, -1 on error.
#[no_mangle]
pub extern "C" fn helios_db_add_message(
    db: *mut Connection,
    conv_id: *const c_char,
    role: *const c_char,
    content: *const c_char,
    timestamp: i64,
) -> i32 {
    let conn = unsafe { &*db };
    let conv_str = unsafe { CStr::from_ptr(conv_id).to_str().unwrap_or("") };
    let role_str = unsafe { CStr::from_ptr(role).to_str().unwrap_or("user") };
    let content_str = unsafe { CStr::from_ptr(content).to_str().unwrap_or("") };

    let msg_id = uuid::Uuid::new_v4().to_string();
    let ts = if timestamp > 0 {
        chrono::DateTime::from_timestamp(timestamp, 0)
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string())
    } else {
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
    };

    match conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![msg_id, conv_str, role_str, content_str, ts],
    ) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

/// Get messages for a conversation (JSON). Caller must free returned string.
#[no_mangle]
pub extern "C" fn helios_db_get_messages(
    db: *mut Connection,
    conv_id: *const c_char,
    limit: i32,
    offset: i32,
) -> *mut c_char {
    let conn = unsafe { &*db };
    let conv_str = unsafe { CStr::from_ptr(conv_id).to_str().unwrap_or("") };

    let messages = (|| -> rusqlite::Result<Vec<Message>> {
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, timestamp FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC LIMIT ?2 OFFSET ?3"
        )?;
        let rows = stmt.query_map(params![conv_str, limit, offset], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
            })
        })?;
        rows.collect()
    })()
    .unwrap_or_default();

    to_json_cstring(&messages, "[]")
}

/// Search messages (FTS5). Returns JSON array.
#[no_mangle]
pub extern "C" fn helios_db_search_messages(
    db: *mut Connection,
    query: *const c_char,
    limit: i32,
) -> *mut c_char {
    let conn = unsafe { &*db };
    let query_str = unsafe { CStr::from_ptr(query).to_str().unwrap_or("") };

    let messages = (|| -> rusqlite::Result<Vec<Message>> {
        let mut stmt = conn.prepare(
            "SELECT m.id, m.conversation_id, m.role, m.content, m.timestamp
             FROM messages_fts f
             JOIN messages m ON m.rowid = f.rowid
             WHERE messages_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![query_str, limit], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
            })
        })?;
        rows.collect()
    })()
    .unwrap_or_default();

    to_json_cstring(&messages, "[]")
}

/// Record token usage for a session.
#[no_mangle]
pub extern "C" fn helios_db_record_token_usage(
    db: *mut Connection,
    session_id: *const c_char,
    prompt_tokens: i32,
    completion_tokens: i32,
    cost_cents: f64,
    backend: *const c_char,
) -> i32 {
    let conn = unsafe { &*db };
    let session_str = unsafe { CStr::from_ptr(session_id).to_str().unwrap_or("") };
    let backend_str = unsafe { CStr::from_ptr(backend).to_str().unwrap_or("unknown") };

    match conn.execute(
        "INSERT INTO token_usage (session_id, prompt_tokens, completion_tokens, cost_cents, backend) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![session_str, prompt_tokens, completion_tokens, cost_cents, backend_str],
    ) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

/// Get token usage stats for a session (JSON).
#[no_mangle]
pub extern "C" fn helios_db_get_token_stats(
    db: *mut Connection,
    session_id: *const c_char,
) -> *mut c_char {
    let conn = unsafe { &*db };
    let session_str = unsafe { CStr::from_ptr(session_id).to_str().unwrap_or("") };

    let mut stmt = match conn.prepare(
        "SELECT session_id,
                COALESCE(SUM(prompt_tokens), 0) as total_prompt,
                COALESCE(SUM(completion_tokens), 0) as total_completion,
                COALESCE(SUM(cost_cents), 0.0) as total_cost,
                COUNT(*) as count
         FROM token_usage WHERE session_id = ?1 GROUP BY session_id"
    ) {
        Ok(s) => stmt
            .query_row(params![s], |row| {
                Ok(TokenStats {
                    session_id: row.get(0)?,
                    total_prompt_tokens: row.get(1)?,
                    total_completion_tokens: row.get(2)?,
                    total_cost_cents: row.get(3)?,
                    usage_count: row.get(4)?,
                })
            })
            .ok(),
        Err(_) => None,
    };

    match stats {
        Some(s) => to_json_cstring(&s, "{}"),
        None => to_c_string("{}".to_string()),
    }
}

/// Free a string returned by this library.
#[no_mangle]
pub extern "C" fn helios_db_free_string(s: *mut c_char) {
    if !s.is_null() {
        unsafe { drop(CString::from_raw(s)); }
    }
}

/// Close the database connection.
#[no_mangle]
pub extern "C" fn helios_db_close(db: *mut Connection) {
    if !db.is_null() {
        unsafe { drop(Box::from_raw(db)); }
    }
}
