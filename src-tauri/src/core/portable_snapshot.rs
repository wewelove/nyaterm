use crate::config::{
    self, ActivityBarLayout, AppSettings, DiagnosticsSettings, InteractionSettings, SearchSettings,
    TerminalSettings, TransferSettings, TranslationSettings,
};
use crate::error::{AppError, AppResult};
use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

use super::{QuickCommandsStore, SessionManager};

const PORTABLE_SNAPSHOT_SCHEMA_VERSION: u32 = 2;
const SNAPSHOT_META_KEY: &str = "meta";
const SNAPSHOT_JSON_PORTABLE_SETTINGS: &str = "portable-settings";

const SNAPSHOT_META_TABLE: TableDefinition<&str, &str> = TableDefinition::new("snapshot_meta");
const SNAPSHOT_JSON_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("json_docs");
const SNAPSHOT_TEXT_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("text_docs");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortableSnapshotKind {
    Sync,
    Backup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableSnapshot {
    pub schema_version: u32,
    pub snapshot_kind: PortableSnapshotKind,
    pub revision_id: String,
    pub device_id: String,
    pub created_at_ms: u64,
    pub payload_hash: String,
    pub app_version: String,
    #[serde(default)]
    pub json_docs: BTreeMap<String, String>,
    #[serde(default)]
    pub text_docs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PortableSnapshotMeta {
    schema_version: u32,
    snapshot_kind: PortableSnapshotKind,
    revision_id: String,
    device_id: String,
    created_at_ms: u64,
    payload_hash: String,
    app_version: String,
}

impl From<&PortableSnapshot> for PortableSnapshotMeta {
    fn from(snapshot: &PortableSnapshot) -> Self {
        Self {
            schema_version: snapshot.schema_version,
            snapshot_kind: snapshot.snapshot_kind.clone(),
            revision_id: snapshot.revision_id.clone(),
            device_id: snapshot.device_id.clone(),
            created_at_ms: snapshot.created_at_ms,
            payload_hash: snapshot.payload_hash.clone(),
            app_version: snapshot.app_version.clone(),
        }
    }
}

#[derive(Serialize)]
struct SnapshotHashInput<'a> {
    json_docs: &'a BTreeMap<String, String>,
    text_docs: &'a BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableUiSettings {
    pub language: Option<String>,
    pub show_remote_stats: bool,
    pub remote_stats_interval: u32,
    pub saved_connections_sort_mode: String,
    pub activity_bar_layout: ActivityBarLayout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableAppSettings {
    pub general: config::GeneralSettings,
    pub appearance: config::AppearanceSettings,
    pub proxy: config::ProxySettings,
    pub search: SearchSettings,
    pub translation: TranslationSettings,
    pub security: config::SecuritySettings,
    pub terminal: TerminalSettings,
    pub interaction: InteractionSettings,
    pub transfer: TransferSettings,
    pub diagnostics: DiagnosticsSettings,
    pub ui: PortableUiSettings,
}

impl PortableAppSettings {
    pub fn from_app_settings(settings: &AppSettings) -> Self {
        let mut security = settings.security.clone();
        security.master_password = None;
        Self {
            general: settings.general.clone(),
            appearance: settings.appearance.clone(),
            proxy: settings.proxy.clone(),
            search: settings.search.clone(),
            translation: settings.translation.clone(),
            security,
            terminal: settings.terminal.clone(),
            interaction: settings.interaction.clone(),
            transfer: settings.transfer.clone(),
            diagnostics: settings.diagnostics.clone(),
            ui: PortableUiSettings {
                language: settings.ui.language.clone(),
                show_remote_stats: settings.ui.show_remote_stats,
                remote_stats_interval: settings.ui.remote_stats_interval,
                saved_connections_sort_mode: settings.ui.saved_connections_sort_mode.clone(),
                activity_bar_layout: settings.ui.activity_bar_layout.clone(),
            },
        }
    }

    pub fn apply_to(self, mut current: AppSettings) -> AppSettings {
        let master_password = current.security.master_password.clone();
        let ui_state = current.ui.clone();

        current.general = self.general;
        current.appearance = self.appearance;
        current.proxy = self.proxy;
        current.search = self.search;
        current.translation = self.translation;
        current.security = self.security;
        current.security.master_password = master_password;
        current.terminal = self.terminal;
        current.interaction = self.interaction;
        current.transfer = self.transfer;
        current.diagnostics = self.diagnostics;
        current.ui.language = self.ui.language;
        current.ui.show_remote_stats = self.ui.show_remote_stats;
        current.ui.remote_stats_interval = self.ui.remote_stats_interval;
        current.ui.saved_connections_sort_mode = self.ui.saved_connections_sort_mode;
        current.ui.activity_bar_layout = self.ui.activity_bar_layout;

        // Preserve device-local UI state.
        current.ui.open_tabs = ui_state.open_tabs;
        current.ui.left_width = ui_state.left_width;
        current.ui.right_width = ui_state.right_width;
        current.ui.quick_cmd_height = ui_state.quick_cmd_height;
        current.ui.active_left_panel = ui_state.active_left_panel;
        current.ui.active_right_panel = ui_state.active_right_panel;
        current.ui.show_quick_cmd_bar = ui_state.show_quick_cmd_bar;
        current.ui.show_serial_send_panel = ui_state.show_serial_send_panel;
        current.ui.serial_send_height = ui_state.serial_send_height;
        current.ui.zoom_level = ui_state.zoom_level;
        current.ui.transfer_height = ui_state.transfer_height;
        current
    }
}

pub fn build_portable_snapshot(
    app: &AppHandle,
    snapshot_kind: PortableSnapshotKind,
    device_id: &str,
) -> AppResult<PortableSnapshot> {
    let _ = config::load_config(app)?;
    let settings = config::load_app_settings(app)?;

    let mut json_docs = BTreeMap::new();
    json_docs.insert(
        crate::storage::JSON_SESSIONS.to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_SESSIONS,
            &serde_json::to_string_pretty(&config::SessionsConfig::default())?,
        )?,
    );
    json_docs.insert(
        crate::storage::JSON_KEYS.to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_KEYS,
            &serde_json::to_string_pretty(&config::KeysConfig::default())?,
        )?,
    );
    json_docs.insert(
        crate::storage::JSON_PASSWORDS.to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_PASSWORDS,
            &serde_json::to_string_pretty(&config::PasswordsConfig::default())?,
        )?,
    );
    json_docs.insert(
        crate::storage::JSON_OTP.to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_OTP,
            &serde_json::to_string_pretty(&config::OtpConfig::default())?,
        )?,
    );
    json_docs.insert(
        crate::storage::JSON_PROXIES.to_string(),
        read_json_doc_or_default(crate::storage::JSON_PROXIES, "{\n  \"proxies\": []\n}")?,
    );
    json_docs.insert(
        crate::storage::JSON_TUNNELS.to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_TUNNELS,
            &serde_json::to_string_pretty(&config::TunnelsConfig::default())?,
        )?,
    );
    json_docs.insert(
        crate::storage::JSON_QUICK_COMMAND.to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_QUICK_COMMAND,
            &serde_json::to_string_pretty(&config::QuickCommandsConfig::default())?,
        )?,
    );
    json_docs.insert(
        SNAPSHOT_JSON_PORTABLE_SETTINGS.to_string(),
        serde_json::to_string_pretty(&PortableAppSettings::from_app_settings(&settings))?,
    );

    if snapshot_kind == PortableSnapshotKind::Backup {
        json_docs.insert(
            crate::storage::JSON_HISTORY.to_string(),
            read_json_doc_or_default(
                crate::storage::JSON_HISTORY,
                "{\n  \"version\": 2,\n  \"entries\": []\n}",
            )?,
        );
    }

    let mut text_docs = BTreeMap::new();
    if let Some(master_key) = crate::storage::load_text_doc(crate::storage::TEXT_MASTER_KEY)? {
        text_docs.insert(crate::storage::TEXT_MASTER_KEY.to_string(), master_key);
    }

    let payload_hash = calculate_payload_hash(&json_docs, &text_docs)?;

    Ok(PortableSnapshot {
        schema_version: PORTABLE_SNAPSHOT_SCHEMA_VERSION,
        snapshot_kind,
        revision_id: uuid::Uuid::new_v4().to_string(),
        device_id: device_id.to_string(),
        created_at_ms: current_time_ms(),
        payload_hash,
        app_version: app.package_info().version.to_string(),
        json_docs,
        text_docs,
    })
}

pub fn decode_portable_snapshot(bytes: &[u8]) -> AppResult<PortableSnapshot> {
    let temp = TempRedbFile::new("portable-snapshot-decode");
    fs::write(temp.path(), bytes)?;

    let snapshot = {
        let db = Database::open(temp.path()).map_err(storage_error)?;
        let read = db.begin_read().map_err(storage_error)?;
        let meta_table = read
            .open_table(SNAPSHOT_META_TABLE)
            .map_err(storage_error)?;
        let meta_raw = meta_table
            .get(SNAPSHOT_META_KEY)
            .map_err(storage_error)?
            .ok_or_else(|| AppError::Config("portable snapshot is missing metadata".to_string()))?
            .value()
            .to_string();
        let meta: PortableSnapshotMeta = serde_json::from_str(&meta_raw)?;

        PortableSnapshot {
            schema_version: meta.schema_version,
            snapshot_kind: meta.snapshot_kind,
            revision_id: meta.revision_id,
            device_id: meta.device_id,
            created_at_ms: meta.created_at_ms,
            payload_hash: meta.payload_hash,
            app_version: meta.app_version,
            json_docs: read_string_table(&read, SNAPSHOT_JSON_DOCS_TABLE)?,
            text_docs: read_string_table(&read, SNAPSHOT_TEXT_DOCS_TABLE)?,
        }
    };

    validate_portable_snapshot(&snapshot)?;
    Ok(snapshot)
}

pub fn encode_portable_snapshot(snapshot: &PortableSnapshot) -> AppResult<Vec<u8>> {
    validate_portable_snapshot(snapshot)?;

    let temp = TempRedbFile::new("portable-snapshot-encode");
    {
        let db = Database::create(temp.path()).map_err(storage_error)?;
        let txn = db.begin_write().map_err(storage_error)?;
        {
            let mut meta = txn.open_table(SNAPSHOT_META_TABLE).map_err(storage_error)?;
            let meta_content = serde_json::to_string(&PortableSnapshotMeta::from(snapshot))?;
            meta.insert(SNAPSHOT_META_KEY, meta_content.as_str())
                .map_err(storage_error)?;
        }
        {
            let mut json_docs = txn
                .open_table(SNAPSHOT_JSON_DOCS_TABLE)
                .map_err(storage_error)?;
            for (key, value) in &snapshot.json_docs {
                json_docs
                    .insert(key.as_str(), value.as_str())
                    .map_err(storage_error)?;
            }
        }
        {
            let mut text_docs = txn
                .open_table(SNAPSHOT_TEXT_DOCS_TABLE)
                .map_err(storage_error)?;
            for (key, value) in &snapshot.text_docs {
                text_docs
                    .insert(key.as_str(), value.as_str())
                    .map_err(storage_error)?;
            }
        }
        txn.commit().map_err(storage_error)?;
    }

    fs::read(temp.path()).map_err(Into::into)
}

pub async fn apply_portable_snapshot(
    app: &AppHandle,
    snapshot: &PortableSnapshot,
) -> AppResult<()> {
    validate_portable_snapshot(snapshot)?;

    for (key, contents) in &snapshot.json_docs {
        if key == SNAPSHOT_JSON_PORTABLE_SETTINGS {
            continue;
        }
        if is_snapshot_json_doc_key(key) {
            crate::storage::save_json_doc_raw(key, contents)?;
        }
    }

    if let Some(settings_raw) = snapshot.json_docs.get(SNAPSHOT_JSON_PORTABLE_SETTINGS) {
        let portable: PortableAppSettings = serde_json::from_str(settings_raw)?;
        let merged = portable.apply_to(config::load_app_settings(app).unwrap_or_default());
        config::save_app_settings(app, &merged)?;
    }

    if let Some(master_key) = snapshot.text_docs.get(crate::storage::TEXT_MASTER_KEY) {
        crate::storage::save_text_doc(crate::storage::TEXT_MASTER_KEY, master_key)?;
    }

    let quick_commands_store = app.state::<Arc<QuickCommandsStore>>();
    quick_commands_store.load_from_disk(app)?;

    let session_manager = app.state::<Arc<SessionManager>>();
    session_manager
        .inner()
        .as_ref()
        .reload_history_from_storage()
        .await?;

    let _ = app.emit("connections-changed", ());
    let _ = app.emit("quick-commands-changed", ());
    let _ = app.emit("settings-changed", ());
    let _ = app.emit("command-history-changed", ());

    Ok(())
}

fn validate_portable_snapshot(snapshot: &PortableSnapshot) -> AppResult<()> {
    if snapshot.schema_version != PORTABLE_SNAPSHOT_SCHEMA_VERSION {
        return Err(AppError::Config(format!(
            "Unsupported portable snapshot version {}",
            snapshot.schema_version
        )));
    }
    let actual = calculate_payload_hash(&snapshot.json_docs, &snapshot.text_docs)?;
    if actual != snapshot.payload_hash {
        return Err(AppError::Crypto(
            "Portable snapshot payload hash mismatch".to_string(),
        ));
    }
    Ok(())
}

fn calculate_payload_hash(
    json_docs: &BTreeMap<String, String>,
    text_docs: &BTreeMap<String, String>,
) -> AppResult<String> {
    let payload_bytes = serde_json::to_vec(&SnapshotHashInput {
        json_docs,
        text_docs,
    })?;
    Ok(hex::encode(Sha256::digest(&payload_bytes)))
}

fn read_json_doc_or_default(key: &str, default_contents: &str) -> AppResult<String> {
    Ok(crate::storage::load_json_doc_raw(key)?.unwrap_or_else(|| default_contents.to_string()))
}

fn is_snapshot_json_doc_key(key: &str) -> bool {
    matches!(
        key,
        crate::storage::JSON_SESSIONS
            | crate::storage::JSON_KEYS
            | crate::storage::JSON_PASSWORDS
            | crate::storage::JSON_OTP
            | crate::storage::JSON_PROXIES
            | crate::storage::JSON_TUNNELS
            | crate::storage::JSON_QUICK_COMMAND
            | crate::storage::JSON_HISTORY
    )
}

fn read_string_table(
    txn: &redb::ReadTransaction,
    definition: TableDefinition<&str, &str>,
) -> AppResult<BTreeMap<String, String>> {
    let table = match txn.open_table(definition) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(BTreeMap::new()),
        Err(error) => return Err(storage_error(error)),
    };

    let mut values = BTreeMap::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, value) = entry.map_err(storage_error)?;
        values.insert(key.value().to_string(), value.value().to_string());
    }
    Ok(values)
}

fn current_time_ms() -> u64 {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(format!("Storage error: {error}"))
}

struct TempRedbFile {
    path: PathBuf,
}

impl TempRedbFile {
    fn new(prefix: &str) -> Self {
        Self {
            path: std::env::temp_dir()
                .join(format!("nyaterm-{prefix}-{}.redb", uuid::Uuid::new_v4())),
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempRedbFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        calculate_payload_hash, encode_portable_snapshot, PortableAppSettings, PortableSnapshot,
        PortableSnapshotKind, PortableUiSettings, PORTABLE_SNAPSHOT_SCHEMA_VERSION,
    };
    use crate::config::{self, ActivityBarLayout, AppSettings};
    use std::collections::BTreeMap;

    #[test]
    fn portable_settings_strip_master_password_and_preserve_device_ui_state_on_apply() {
        let mut current = AppSettings::default();
        current.security.master_password = Some("encrypted-master".to_string());
        current.ui.left_width = 444.0;
        current.ui.active_left_panel = Some("fileExplorer".to_string());

        let mut updated = PortableAppSettings::from_app_settings(&current);
        updated.general.startup_restore = false;
        updated.ui.language = Some("zh-CN".to_string());
        updated.ui.saved_connections_sort_mode = "name-asc".to_string();

        let merged = updated.apply_to(current.clone());
        assert_eq!(
            merged.security.master_password,
            current.security.master_password
        );
        assert_eq!(merged.ui.left_width, current.ui.left_width);
        assert_eq!(merged.ui.active_left_panel, current.ui.active_left_panel);
        assert_eq!(merged.ui.language.as_deref(), Some("zh-CN"));
        assert_eq!(merged.ui.saved_connections_sort_mode, "name-asc");
    }

    #[test]
    fn portable_snapshot_hash_is_stable_for_sorted_docs() {
        let left_json = BTreeMap::from([
            ("sessions".to_string(), "{\"connections\":[]}".to_string()),
            ("keys".to_string(), "{\"keys\":[]}".to_string()),
        ]);
        let right_json = BTreeMap::from([
            ("keys".to_string(), "{\"keys\":[]}".to_string()),
            ("sessions".to_string(), "{\"connections\":[]}".to_string()),
        ]);
        let text_docs = BTreeMap::from([("master.key".to_string(), "wrapped".to_string())]);

        assert_eq!(
            calculate_payload_hash(&left_json, &text_docs).expect("left hash"),
            calculate_payload_hash(&right_json, &text_docs).expect("right hash")
        );
    }

    #[test]
    fn portable_snapshot_redb_roundtrip() {
        let json_docs = BTreeMap::from([(
            "portable-settings".to_string(),
            serde_json::to_string(&PortableAppSettings {
                general: config::GeneralSettings::default(),
                appearance: config::AppearanceSettings::default(),
                proxy: config::ProxySettings::default(),
                search: config::SearchSettings::default(),
                translation: config::TranslationSettings::default(),
                security: config::SecuritySettings::default(),
                terminal: config::TerminalSettings::default(),
                interaction: config::InteractionSettings::default(),
                transfer: config::TransferSettings::default(),
                diagnostics: config::DiagnosticsSettings::default(),
                ui: PortableUiSettings {
                    language: Some("en".to_string()),
                    show_remote_stats: false,
                    remote_stats_interval: 3,
                    saved_connections_sort_mode: "default".to_string(),
                    activity_bar_layout: ActivityBarLayout::default(),
                },
            })
            .expect("serialize portable settings"),
        )]);
        let text_docs = BTreeMap::from([("master.key".to_string(), "wrapped".to_string())]);
        let payload_hash =
            calculate_payload_hash(&json_docs, &text_docs).expect("calculate payload hash");
        let snapshot = PortableSnapshot {
            schema_version: PORTABLE_SNAPSHOT_SCHEMA_VERSION,
            snapshot_kind: PortableSnapshotKind::Sync,
            revision_id: "rev".to_string(),
            device_id: "dev".to_string(),
            created_at_ms: 1,
            payload_hash,
            app_version: "1.0.0".to_string(),
            json_docs,
            text_docs,
        };

        let encoded = encode_portable_snapshot(&snapshot).expect("encode snapshot");
        let decoded = super::decode_portable_snapshot(&encoded).expect("decode snapshot");

        assert_eq!(decoded.revision_id, snapshot.revision_id);
        assert_eq!(decoded.payload_hash, snapshot.payload_hash);
        assert_eq!(decoded.json_docs, snapshot.json_docs);
        assert_eq!(decoded.text_docs, snapshot.text_docs);
    }
}
