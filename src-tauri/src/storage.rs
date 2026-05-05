//! redb-backed persistence for NyaTerm's user data.
//!
//! The public API stores the same JSON/text payloads that used to live as
//! files under `~/.nyaterm`, so higher layers can keep their serde models.

use crate::error::{AppError, AppResult};
use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};
use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

const DATABASE_FILE: &str = "nyaterm.redb";
const LEGACY_CONFIG_DIR: &str = ".dragonfly";
const LEGACY_DATABASE_FILE: &str = "dragonfly.redb";
const SCHEMA_VERSION: &str = "1";
const META_SCHEMA_VERSION: &str = "schema_version";
const META_LEGACY_MIGRATED: &str = "legacy_migrated";

const META_TABLE: TableDefinition<&str, &str> = TableDefinition::new("meta");
const JSON_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("json_docs");
const TEXT_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("text_docs");

pub const JSON_SETTINGS: &str = "settings";
pub const JSON_SESSIONS: &str = "sessions";
pub const JSON_KEYS: &str = "keys";
pub const JSON_PASSWORDS: &str = "passwords";
pub const JSON_OTP: &str = "otp";
pub const JSON_PROXIES: &str = "proxies";
pub const JSON_TUNNELS: &str = "tunnels";
pub const JSON_QUICK_COMMAND: &str = "quick-command";
pub const JSON_CLOUD_SYNC: &str = "cloud-sync";
pub const JSON_CLOUD_SYNC_STATE: &str = "cloud-sync-state";
pub const JSON_HISTORY: &str = "history";
pub const JSON_AI_HISTORY: &str = "ai-history";
pub const JSON_AI_AUDIT: &str = "ai-audit";

pub const TEXT_KNOWN_HOSTS: &str = "known_hosts";
pub const TEXT_MASTER_KEY: &str = "master.key";

static DATABASE: OnceLock<Arc<Database>> = OnceLock::new();

const LEGACY_JSON_FILES: &[(&str, &str)] = &[
    ("settings.json", JSON_SETTINGS),
    ("sessions.json", JSON_SESSIONS),
    ("keys.json", JSON_KEYS),
    ("passwords.json", JSON_PASSWORDS),
    ("otp.json", JSON_OTP),
    ("proxies.json", JSON_PROXIES),
    ("tunnels.json", JSON_TUNNELS),
    ("quick-command.json", JSON_QUICK_COMMAND),
    ("cloud_sync.json", JSON_CLOUD_SYNC),
    ("cloud_sync_state.json", JSON_CLOUD_SYNC_STATE),
    ("history.json", JSON_HISTORY),
    ("ai-history.json", JSON_AI_HISTORY),
    ("ai-audit.json", JSON_AI_AUDIT),
];

const LEGACY_TEXT_FILES: &[(&str, &str)] = &[
    ("known_hosts", TEXT_KNOWN_HOSTS),
    ("master.key", TEXT_MASTER_KEY),
];

pub fn init(config_dir: &Path) -> AppResult<()> {
    fs::create_dir_all(config_dir)?;
    bootstrap_from_legacy_dragonfly_config(config_dir)?;
    let db_path = config_dir.join(DATABASE_FILE);
    let db = Arc::new(open_database(&db_path)?);
    migrate_legacy_files(&db, config_dir)?;

    if DATABASE.set(db).is_err() {
        tracing::debug!("redb storage was already initialized");
    }
    Ok(())
}

#[cfg(test)]
fn database_path(config_dir: &Path) -> PathBuf {
    config_dir.join(DATABASE_FILE)
}

#[allow(dead_code)]
pub fn json_key_for_legacy_file(file_name: &str) -> Option<&'static str> {
    LEGACY_JSON_FILES
        .iter()
        .find_map(|(name, key)| (*name == file_name).then_some(*key))
}

#[allow(dead_code)]
pub fn text_key_for_legacy_file(file_name: &str) -> Option<&'static str> {
    LEGACY_TEXT_FILES
        .iter()
        .find_map(|(name, key)| (*name == file_name).then_some(*key))
}

pub fn load_json_doc<T: serde::de::DeserializeOwned + Default>(key: &str) -> AppResult<T> {
    let Some(raw) = load_json_doc_raw(key)? else {
        return Ok(T::default());
    };
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_json_doc<T: Serialize>(key: &str, data: &T) -> AppResult<()> {
    let content = serde_json::to_string_pretty(data)?;
    save_json_doc_raw(key, &content)
}

pub fn update_json_doc<T, R, F>(key: &str, updater: F) -> AppResult<R>
where
    T: DeserializeOwned + Default + Serialize,
    F: FnOnce(&mut T) -> AppResult<R>,
{
    let db = database()?;
    update_json_doc_in_db(&db, key, updater)
}

pub fn load_json_doc_raw(key: &str) -> AppResult<Option<String>> {
    let db = database()?;
    read_json_doc(&db, key)
}

pub fn save_json_doc_raw(key: &str, value: &str) -> AppResult<()> {
    let db = database()?;
    write_json_doc(&db, key, value)
}

pub fn load_text_doc(key: &str) -> AppResult<Option<String>> {
    let db = database()?;
    read_text_doc(&db, key)
}

pub fn save_text_doc(key: &str, value: &str) -> AppResult<()> {
    let db = database()?;
    write_text_doc(&db, key, value)
}

pub fn append_text_line(key: &str, line: &str) -> AppResult<()> {
    let mut current = load_text_doc(key)?.unwrap_or_default();
    if !current.is_empty() && !current.ends_with('\n') {
        current.push('\n');
    }
    current.push_str(line);
    current.push('\n');
    save_text_doc(key, &current)
}

fn database() -> AppResult<Arc<Database>> {
    if let Some(db) = DATABASE.get() {
        return Ok(db.clone());
    }

    let config_dir = default_config_dir()?;
    init(&config_dir)?;
    DATABASE
        .get()
        .cloned()
        .ok_or_else(|| AppError::Storage("redb storage did not initialize".to_string()))
}

fn default_config_dir() -> AppResult<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Config("cannot determine home directory".to_string()))?;
    Ok(home.join(".nyaterm"))
}

fn bootstrap_from_legacy_dragonfly_config(config_dir: &Path) -> AppResult<()> {
    let Some(home_dir) = config_dir.parent() else {
        return Ok(());
    };

    let legacy_dir = home_dir.join(LEGACY_CONFIG_DIR);
    bootstrap_from_legacy_config_dir(config_dir, &legacy_dir)
}

fn bootstrap_from_legacy_config_dir(config_dir: &Path, legacy_dir: &Path) -> AppResult<()> {
    let db_path = config_dir.join(DATABASE_FILE);
    if db_path.exists() || !legacy_dir.is_dir() {
        return Ok(());
    }

    let legacy_db_path = legacy_dir.join(LEGACY_DATABASE_FILE);
    if legacy_db_path.is_file() {
        fs::copy(&legacy_db_path, &db_path)?;
        tracing::info!(
            "Migrated NyaTerm storage database from legacy Dragonfly path '{}'",
            legacy_db_path.display()
        );
        return Ok(());
    }

    let mut copied_legacy_files = 0usize;
    for &(file_name, _) in LEGACY_JSON_FILES.iter().chain(LEGACY_TEXT_FILES.iter()) {
        let source = legacy_dir.join(file_name);
        if !source.is_file() {
            continue;
        }
        let destination = config_dir.join(file_name);
        if destination.exists() {
            continue;
        }
        fs::copy(&source, &destination)?;
        copied_legacy_files += 1;
    }

    if copied_legacy_files > 0 {
        tracing::info!(
            "Copied {} legacy Dragonfly storage file(s) into NyaTerm storage for redb migration",
            copied_legacy_files
        );
    }

    Ok(())
}

fn open_database(path: &Path) -> AppResult<Database> {
    if path.exists() {
        Database::open(path).map_err(storage_error)
    } else {
        Database::create(path).map_err(storage_error)
    }
}

fn migrate_legacy_files(db: &Database, config_dir: &Path) -> AppResult<()> {
    let mut migrated_files = Vec::new();
    let txn = db.begin_write().map_err(storage_error)?;
    {
        let mut meta = txn.open_table(META_TABLE).map_err(storage_error)?;
        meta.insert(META_SCHEMA_VERSION, SCHEMA_VERSION)
            .map_err(storage_error)?;
    }

    {
        let mut json_docs = txn.open_table(JSON_DOCS_TABLE).map_err(storage_error)?;
        for (file_name, key) in LEGACY_JSON_FILES {
            let path = config_dir.join(file_name);
            if json_docs.get(*key).map_err(storage_error)?.is_some() {
                migrated_files.push(path);
                continue;
            }
            if !path.is_file() {
                continue;
            }
            let content = fs::read_to_string(&path)?;
            json_docs
                .insert(*key, content.as_str())
                .map_err(storage_error)?;
            migrated_files.push(path);
        }
    }

    {
        let mut text_docs = txn.open_table(TEXT_DOCS_TABLE).map_err(storage_error)?;
        for (file_name, key) in LEGACY_TEXT_FILES {
            let path = config_dir.join(file_name);
            if text_docs.get(*key).map_err(storage_error)?.is_some() {
                migrated_files.push(path);
                continue;
            }
            if !path.is_file() {
                continue;
            }
            let content = fs::read_to_string(&path)?;
            text_docs
                .insert(*key, content.as_str())
                .map_err(storage_error)?;
            migrated_files.push(path);
        }
    }

    {
        let mut meta = txn.open_table(META_TABLE).map_err(storage_error)?;
        meta.insert(META_LEGACY_MIGRATED, "true")
            .map_err(storage_error)?;
    }

    txn.commit().map_err(storage_error)?;
    cleanup_legacy_files(migrated_files);
    Ok(())
}

fn cleanup_legacy_files(paths: Vec<PathBuf>) {
    for path in paths {
        if !path.is_file() {
            continue;
        }
        if let Err(error) = fs::remove_file(&path) {
            tracing::warn!(
                "Failed to remove migrated legacy storage file '{}': {}",
                path.display(),
                error
            );
        }
    }
}

fn update_json_doc_in_db<T, R, F>(db: &Database, key: &str, updater: F) -> AppResult<R>
where
    T: DeserializeOwned + Default + Serialize,
    F: FnOnce(&mut T) -> AppResult<R>,
{
    let txn = db.begin_write().map_err(storage_error)?;
    let result = {
        let mut table = txn.open_table(JSON_DOCS_TABLE).map_err(storage_error)?;
        let mut document = match table.get(key).map_err(storage_error)? {
            Some(guard) => serde_json::from_str::<T>(guard.value())?,
            None => T::default(),
        };
        let result = updater(&mut document)?;
        let content = serde_json::to_string_pretty(&document)?;
        table.insert(key, content.as_str()).map_err(storage_error)?;
        result
    };
    txn.commit().map_err(storage_error)?;
    Ok(result)
}

fn read_json_doc(db: &Database, key: &str) -> AppResult<Option<String>> {
    let txn = db.begin_read().map_err(storage_error)?;
    let table = match txn.open_table(JSON_DOCS_TABLE) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
        Err(error) => return Err(storage_error(error)),
    };
    Ok(table
        .get(key)
        .map_err(storage_error)?
        .map(|guard| guard.value().to_string()))
}

fn write_json_doc(db: &Database, key: &str, value: &str) -> AppResult<()> {
    let txn = db.begin_write().map_err(storage_error)?;
    {
        let mut table = txn.open_table(JSON_DOCS_TABLE).map_err(storage_error)?;
        table.insert(key, value).map_err(storage_error)?;
    }
    txn.commit().map_err(storage_error)?;
    Ok(())
}

fn read_text_doc(db: &Database, key: &str) -> AppResult<Option<String>> {
    let txn = db.begin_read().map_err(storage_error)?;
    let table = match txn.open_table(TEXT_DOCS_TABLE) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
        Err(error) => return Err(storage_error(error)),
    };
    Ok(table
        .get(key)
        .map_err(storage_error)?
        .map(|guard| guard.value().to_string()))
}

fn write_text_doc(db: &Database, key: &str, value: &str) -> AppResult<()> {
    let txn = db.begin_write().map_err(storage_error)?;
    {
        let mut table = txn.open_table(TEXT_DOCS_TABLE).map_err(storage_error)?;
        table.insert(key, value).map_err(storage_error)?;
    }
    txn.commit().map_err(storage_error)?;
    Ok(())
}

fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(format!("Storage error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_config_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("nyaterm-redb-{name}-{nanos}"))
    }

    #[test]
    fn redb_json_and_text_roundtrip() {
        let dir = unique_config_dir("roundtrip");
        fs::create_dir_all(&dir).expect("create temp dir");
        let db = open_database(&database_path(&dir)).expect("open db");

        write_json_doc(&db, JSON_SETTINGS, "{\"ok\":true}").expect("write json");
        write_text_doc(&db, TEXT_KNOWN_HOSTS, "example ssh-ed25519 abc\n").expect("write text");

        assert_eq!(
            read_json_doc(&db, JSON_SETTINGS)
                .expect("read json")
                .as_deref(),
            Some("{\"ok\":true}")
        );
        assert_eq!(
            read_text_doc(&db, TEXT_KNOWN_HOSTS)
                .expect("read text")
                .as_deref(),
            Some("example ssh-ed25519 abc\n")
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn migration_keeps_existing_redb_values_and_removes_legacy_files() {
        let dir = unique_config_dir("migration");
        fs::create_dir_all(&dir).expect("create temp dir");
        fs::write(dir.join("settings.json"), "{\"legacy\":true}").expect("write settings");
        fs::write(dir.join("known_hosts"), "legacy-host key value\n").expect("write known_hosts");

        let db = open_database(&database_path(&dir)).expect("open db");
        write_json_doc(&db, JSON_SETTINGS, "{\"existing\":true}").expect("preseed");
        migrate_legacy_files(&db, &dir).expect("migrate");

        assert_eq!(
            read_json_doc(&db, JSON_SETTINGS)
                .expect("read settings")
                .as_deref(),
            Some("{\"existing\":true}")
        );
        assert_eq!(
            read_text_doc(&db, TEXT_KNOWN_HOSTS)
                .expect("read known_hosts")
                .as_deref(),
            Some("legacy-host key value\n")
        );
        assert!(!dir.join("settings.json").exists());
        assert!(!dir.join("known_hosts").exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn bootstrap_copies_legacy_dragonfly_redb_when_new_database_is_missing() {
        let root = unique_config_dir("legacy-redb-root");
        let current_dir = root.join(".nyaterm");
        let legacy_dir = root.join(LEGACY_CONFIG_DIR);
        fs::create_dir_all(&current_dir).expect("create current dir");
        fs::create_dir_all(&legacy_dir).expect("create legacy dir");

        let legacy_db = open_database(&legacy_dir.join(LEGACY_DATABASE_FILE)).expect("open legacy");
        write_json_doc(&legacy_db, JSON_SETTINGS, "{\"legacy\":true}").expect("write legacy");

        bootstrap_from_legacy_config_dir(&current_dir, &legacy_dir).expect("bootstrap");
        let current_db = open_database(&database_path(&current_dir)).expect("open current");

        assert_eq!(
            read_json_doc(&current_db, JSON_SETTINGS)
                .expect("read settings")
                .as_deref(),
            Some("{\"legacy\":true}")
        );
        assert!(legacy_dir.join(LEGACY_DATABASE_FILE).exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bootstrap_copies_legacy_dragonfly_files_for_redb_migration() {
        let root = unique_config_dir("legacy-files-root");
        let current_dir = root.join(".nyaterm");
        let legacy_dir = root.join(LEGACY_CONFIG_DIR);
        fs::create_dir_all(&current_dir).expect("create current dir");
        fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        fs::write(legacy_dir.join("settings.json"), "{\"legacy\":true}").expect("write settings");
        fs::write(legacy_dir.join("known_hosts"), "legacy-host key value\n")
            .expect("write known_hosts");

        bootstrap_from_legacy_config_dir(&current_dir, &legacy_dir).expect("bootstrap");
        let db = open_database(&database_path(&current_dir)).expect("open db");
        migrate_legacy_files(&db, &current_dir).expect("migrate copied legacy files");

        assert_eq!(
            read_json_doc(&db, JSON_SETTINGS)
                .expect("read settings")
                .as_deref(),
            Some("{\"legacy\":true}")
        );
        assert_eq!(
            read_text_doc(&db, TEXT_KNOWN_HOSTS)
                .expect("read known hosts")
                .as_deref(),
            Some("legacy-host key value\n")
        );
        assert!(legacy_dir.join("settings.json").exists());
        assert!(legacy_dir.join("known_hosts").exists());
        assert!(!current_dir.join("settings.json").exists());
        assert!(!current_dir.join("known_hosts").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migration_backfills_missing_docs_after_legacy_marker() {
        let dir = unique_config_dir("migration-backfill");
        fs::create_dir_all(&dir).expect("create temp dir");
        fs::write(
            dir.join("ai-history.json"),
            "{\"sessions\":[],\"messages\":[]}",
        )
        .expect("write ai history");

        let db = open_database(&database_path(&dir)).expect("open db");
        let txn = db.begin_write().expect("begin write");
        {
            let mut meta = txn.open_table(META_TABLE).expect("open meta");
            meta.insert(META_SCHEMA_VERSION, SCHEMA_VERSION)
                .expect("schema version");
            meta.insert(META_LEGACY_MIGRATED, "true")
                .expect("legacy marker");
        }
        txn.commit().expect("commit marker");

        migrate_legacy_files(&db, &dir).expect("migrate");

        assert_eq!(
            read_json_doc(&db, JSON_AI_HISTORY)
                .expect("read ai history")
                .as_deref(),
            Some("{\"sessions\":[],\"messages\":[]}")
        );
        assert!(!dir.join("ai-history.json").exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn failed_migration_keeps_legacy_file() {
        let dir = unique_config_dir("migration-failure");
        fs::create_dir_all(&dir).expect("create temp dir");
        fs::write(dir.join("settings.json"), [0xff, 0xfe]).expect("write invalid utf8");

        let db = open_database(&database_path(&dir)).expect("open db");
        assert!(migrate_legacy_files(&db, &dir).is_err());
        assert!(dir.join("settings.json").exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn new_storage_initializes_redb_without_legacy_files() {
        let dir = unique_config_dir("new-storage");
        fs::create_dir_all(&dir).expect("create temp dir");

        let db = open_database(&database_path(&dir)).expect("open db");
        migrate_legacy_files(&db, &dir).expect("initialize");

        assert!(database_path(&dir).exists());
        assert!(!dir.join("settings.json").exists());
        assert_eq!(
            read_json_doc(&db, JSON_SETTINGS)
                .expect("read missing settings")
                .as_deref(),
            None
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
    struct AppendDoc {
        #[serde(default)]
        items: Vec<String>,
    }

    #[test]
    fn atomic_json_update_preserves_sequential_appends() {
        let dir = unique_config_dir("atomic-update");
        fs::create_dir_all(&dir).expect("create temp dir");
        let db = open_database(&database_path(&dir)).expect("open db");

        update_json_doc_in_db::<AppendDoc, _, _>(&db, JSON_AI_HISTORY, |doc| {
            doc.items.push("one".to_string());
            Ok(())
        })
        .expect("append one");
        update_json_doc_in_db::<AppendDoc, _, _>(&db, JSON_AI_HISTORY, |doc| {
            doc.items.push("two".to_string());
            Ok(())
        })
        .expect("append two");

        let doc: AppendDoc = serde_json::from_str(
            &read_json_doc(&db, JSON_AI_HISTORY)
                .expect("read append doc")
                .expect("append doc exists"),
        )
        .expect("parse append doc");
        assert_eq!(doc.items, ["one", "two"]);

        let _ = fs::remove_dir_all(dir);
    }
}
