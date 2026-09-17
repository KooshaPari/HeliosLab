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
    // A C caller can pass null. Dereferencing it would take down the host
    // process, which this crate's own null-argument test demonstrated by
    // segfaulting.
    let Some(conn) = (unsafe { db.as_ref() }) else {
        return -1;
    };
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
    let Some(conn) = (unsafe { db.as_ref() }) else {
        return -1;
    };
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
    let Some(conn) = (unsafe { db.as_ref() }) else {
        return to_c_string("[]".to_string());
    };
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
    let Some(conn) = (unsafe { db.as_ref() }) else {
        return to_c_string("[]".to_string());
    };
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
    let Some(conn) = (unsafe { db.as_ref() }) else {
        return -1;
    };
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
    let Some(conn) = (unsafe { db.as_ref() }) else {
        return to_c_string("{}".to_string());
    };
    let session_str = unsafe { CStr::from_ptr(session_id).to_str().unwrap_or("") };

    // An earlier edit spliced this together with the previous function: it
    // referenced `stmt` inside its own initializer and left `stats` undefined.
    // Nothing could have caught that without a compiler, and there was no Rust
    // toolchain on the development host until this was first run.
    let stats = match conn.prepare(
        "SELECT session_id,
                COALESCE(SUM(prompt_tokens), 0) as total_prompt,
                COALESCE(SUM(completion_tokens), 0) as total_completion,
                COALESCE(SUM(cost_cents), 0.0) as total_cost,
                COUNT(*) as count
         FROM token_usage WHERE session_id = ?1 GROUP BY session_id"
    ) {
        Ok(mut stmt) => stmt
            .query_row(params![session_str], |row| {
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

// ============================================================================
// Tests
// ============================================================================
//
// These drive the exported C functions directly, so they cover the same path
// the Bun bridge uses: open, schema creation, insert, read back, FTS search and
// token aggregation.
//
// Each test opens its own file in the temp directory, named after the test, so
// they do not collide when run in parallel.

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    /// A database in the temp directory, removed first so runs are independent.
    fn fresh_db(name: &str) -> *mut Connection {
        let path = std::env::temp_dir().join(format!("helios_persistence_{name}.db"));
        let _ = std::fs::remove_file(&path);
        let c_path = CString::new(path.to_str().unwrap()).unwrap();
        let db = helios_db_open(c_path.as_ptr());
        assert!(!db.is_null(), "helios_db_open returned null for {name}");
        db
    }

    fn cs(s: &str) -> CString {
        CString::new(s).unwrap()
    }

    /// Take ownership of a string the library allocated.
    fn take(ptr: *mut c_char) -> String {
        assert!(!ptr.is_null(), "expected a string, got null");
        let s = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
        helios_db_free_string(ptr);
        s
    }

    #[test]
    fn opens_and_creates_the_schema() {
        let db = fresh_db("schema");
        // If the FTS5 table or its triggers had failed to create, open would
        // have returned null and fresh_db would already have panicked. Prove
        // the tables exist by inserting through them.
        let conv = cs("c1");
        let title = cs("First");
        let model = cs("m1");
        assert_eq!(0, helios_db_create_conversation(db, conv.as_ptr(), title.as_ptr(), model.as_ptr()));
        helios_db_close(db);
    }

    #[test]
    fn stores_and_reads_messages_in_order() {
        let db = fresh_db("messages");
        let conv = cs("c1");
        assert_eq!(0, helios_db_create_conversation(db, conv.as_ptr(), cs("t").as_ptr(), cs("m").as_ptr()));

        for (role, text) in [("user", "hello"), ("assistant", "hi there"), ("user", "bye")] {
            let rc = helios_db_add_message(db, conv.as_ptr(), cs(role).as_ptr(), cs(text).as_ptr(), 0);
            assert_eq!(0, rc, "add_message failed for {text}");
        }

        let json = take(helios_db_get_messages(db, conv.as_ptr(), 50, 0));
        let parsed: Vec<Message> = serde_json::from_str(&json).unwrap();
        assert_eq!(3, parsed.len());
        assert_eq!("hello", parsed[0].content);
        assert_eq!("hi there", parsed[1].content);
        assert_eq!("bye", parsed[2].content);
        assert_eq!("assistant", parsed[1].role);

        helios_db_close(db);
    }

    #[test]
    fn fts_search_finds_a_message() {
        let db = fresh_db("fts");
        let conv = cs("c1");
        assert_eq!(0, helios_db_create_conversation(db, conv.as_ptr(), cs("t").as_ptr(), cs("m").as_ptr()));
        assert_eq!(0, helios_db_add_message(db, conv.as_ptr(), cs("user").as_ptr(), cs("the quick brown fox").as_ptr(), 0));
        assert_eq!(0, helios_db_add_message(db, conv.as_ptr(), cs("user").as_ptr(), cs("unrelated content").as_ptr(), 0));

        // Exercises the FTS5 external-content table and its insert trigger.
        let json = take(helios_db_search_messages(db, cs("quick").as_ptr(), 10));
        let hits: Vec<Message> = serde_json::from_str(&json).unwrap();
        assert_eq!(1, hits.len());
        assert!(hits[0].content.contains("quick"));

        helios_db_close(db);
    }

    #[test]
    fn fts_search_with_no_match_returns_empty() {
        let db = fresh_db("fts_empty");
        let conv = cs("c1");
        assert_eq!(0, helios_db_create_conversation(db, conv.as_ptr(), cs("t").as_ptr(), cs("m").as_ptr()));
        assert_eq!(0, helios_db_add_message(db, conv.as_ptr(), cs("user").as_ptr(), cs("alpha").as_ptr(), 0));

        let json = take(helios_db_search_messages(db, cs("zzzznothing").as_ptr(), 10));
        let hits: Vec<Message> = serde_json::from_str(&json).unwrap();
        assert!(hits.is_empty());
        helios_db_close(db);
    }

    #[test]
    fn token_usage_aggregates_per_session() {
        let db = fresh_db("tokens");
        let s = cs("sess-1");
        assert_eq!(0, helios_db_record_token_usage(db, s.as_ptr(), 100, 50, 1.5, cs("llama_cpp").as_ptr()));
        assert_eq!(0, helios_db_record_token_usage(db, s.as_ptr(), 200, 25, 0.5, cs("anthropic").as_ptr()));

        let json = take(helios_db_get_token_stats(db, s.as_ptr()));
        let stats: TokenStats = serde_json::from_str(&json).unwrap();
        assert_eq!(300, stats.total_prompt_tokens);
        assert_eq!(75, stats.total_completion_tokens);
        assert_eq!(2, stats.usage_count);
        assert!((stats.total_cost_cents - 2.0).abs() < 1e-9);

        helios_db_close(db);
    }

    #[test]
    fn token_stats_for_unknown_session_is_empty_object() {
        let db = fresh_db("tokens_empty");
        let json = take(helios_db_get_token_stats(db, cs("nobody").as_ptr()));
        assert_eq!("{}", json);
        helios_db_close(db);
    }

    #[test]
    fn content_containing_a_nul_byte_is_read_back_safely() {
        let db = fresh_db("nul");
        let conv = cs("c1");
        assert_eq!(0, helios_db_create_conversation(db, conv.as_ptr(), cs("t").as_ptr(), cs("m").as_ptr()));

        // The row is written through SQLite directly, not through the C ABI: a
        // C string is NUL-terminated by definition, so CString::new refuses to
        // build one containing an interior NUL. An earlier version of this test
        // tried to, and panicked on its own construction rather than exercising
        // anything.
        //
        // What matters is the read path. to_c_string strips interior NULs
        // because the original code called unwrap on CString::new and would
        // have aborted the host process.
        {
            let conn = unsafe { &*db };
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, timestamp) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["m1", "c1", "user", "before\0after", "2026-01-01T00:00:00Z"],
            )
            .expect("insert with an embedded NUL");
        }

        let json = take(helios_db_get_messages(db, conv.as_ptr(), 50, 0));
        let parsed: Vec<Message> =
            serde_json::from_str(&json).expect("output must remain valid JSON");
        assert_eq!(1, parsed.len());
        // serde_json escapes a NUL as \u0000, so the exact bytes depend on
        // which layer handled it. Both layers must have coped without aborting.
        assert!(parsed[0].content.contains("before"), "got {:?}", parsed[0].content);

        helios_db_close(db);
    }

    #[test]
    fn unknown_conversation_returns_empty_array() {
        let db = fresh_db("missing_conv");
        let json = take(helios_db_get_messages(db, cs("no-such-conv").as_ptr(), 50, 0));
        assert_eq!("[]", json);
        helios_db_close(db);
    }

    #[test]
    fn null_arguments_do_not_crash() {
        // The bridge could in principle pass null through; the helpers check for
        // it rather than dereferencing.
        let json = take(helios_db_get_messages(std::ptr::null_mut(), cs("x").as_ptr(), 10, 0));
        assert_eq!("[]", json);
        // close on null must be a no-op, not a double free.
        helios_db_close(std::ptr::null_mut());
    }
}
