use crate::config::{
    self, CloudConflictPreview, CloudSyncHistoryEntry, CloudSyncSettings, CloudSyncState,
    CloudSyncStatus, RemoteBackupEntry, RemoteBackupIndex,
};
use crate::error::{AppError, AppResult};
use crate::observability::{
    self, StructuredLog, StructuredLogLevel, LOG_FILE_PREFIX, LOG_FILE_SUFFIX,
};
use opendal::layers::{RetryLayer, TimeoutLayer, TracingLayer};
use opendal::services::{Webdav, S3};
use opendal::{ErrorKind, Operator};
use redb::{Database, ReadableDatabase, TableDefinition};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{async_runtime, Emitter, Manager};
use tokio::sync::{Mutex, Notify};

use super::cloud_crypto::{
    decrypt_snapshot_bytes, encrypt_snapshot_bytes, require_master_password,
};
use super::portable_snapshot::{
    apply_portable_snapshot, build_portable_snapshot, decode_portable_snapshot,
    encode_portable_snapshot, PortableSnapshotKind,
};

const SYNC_LATEST_FILE: &str = "sync/latest.redb";
const SYNC_SNAPSHOTS_DIR: &str = "sync/snapshots/";
const BACKUPS_INDEX_FILE: &str = "backups/index.redb";
const BACKUPS_SNAPSHOTS_DIR: &str = "backups/snapshots/";
const HISTORY_LIMIT: usize = 200;
const BACKUP_CHECK_INTERVAL: Duration = Duration::from_secs(60);
const HISTORY_LOG_DOMAIN: &str = "cloud_sync.history";
const HISTORY_LOG_EVENT: &str = "entry";
const REMOTE_SYNC_POINTER_KEY: &str = "latest";
const REMOTE_BACKUP_INDEX_KEY: &str = "index";

const REMOTE_SYNC_POINTER_TABLE: TableDefinition<&str, &str> = TableDefinition::new("sync_pointer");
const REMOTE_BACKUP_INDEX_TABLE: TableDefinition<&str, &str> = TableDefinition::new("backup_index");

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteSyncPointer {
    revision_id: String,
    created_at_ms: u64,
    payload_hash: String,
    device_id: String,
    app_version: String,
}

pub struct CloudSyncManager {
    app_handle: OnceLock<tauri::AppHandle>,
    settings: Arc<Mutex<CloudSyncSettings>>,
    state: Arc<Mutex<CloudSyncState>>,
    status: Arc<Mutex<CloudSyncStatus>>,
    auto_push_notify: Arc<Notify>,
    auto_push_worker_started: AtomicBool,
    backup_worker_started: AtomicBool,
    operation_lock: Arc<Mutex<()>>,
}

impl CloudSyncManager {
    pub fn new() -> Self {
        Self {
            app_handle: OnceLock::new(),
            settings: Arc::new(Mutex::new(CloudSyncSettings::default())),
            state: Arc::new(Mutex::new(CloudSyncState::default())),
            status: Arc::new(Mutex::new(CloudSyncStatus::default())),
            auto_push_notify: Arc::new(Notify::new()),
            auto_push_worker_started: AtomicBool::new(false),
            backup_worker_started: AtomicBool::new(false),
            operation_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn set_app_handle(&self, app: tauri::AppHandle) {
        let _ = self.app_handle.set(app);
    }

    pub async fn init(self: &Arc<Self>, app: tauri::AppHandle) -> AppResult<()> {
        self.set_app_handle(app.clone());

        {
            let settings = config::load_app_settings(&app)
                .map(|settings| settings.cloud_sync)
                .unwrap_or_default();
            *self.settings.lock().await = settings;
        }
        {
            let mut state = config::load_cloud_sync_state(&app).unwrap_or_default();
            if state.device_id.is_empty() {
                state.device_id = uuid::Uuid::new_v4().to_string();
                let _ = config::save_cloud_sync_state(&app, &state);
            }
            *self.state.lock().await = state;
        }
        self.ensure_auto_push_worker();
        self.ensure_backup_worker();

        self.set_status("idle", String::new(), None, None).await;

        let settings = self.settings.lock().await.clone();
        if settings.enabled && settings.auto_check_on_startup {
            let manager = Arc::clone(self);
            async_runtime::spawn(async move {
                if let Err(error) = manager.startup_check().await {
                    manager
                        .record_failure("sync", "startup_check", &error)
                        .await;
                    tracing::warn!("Startup cloud sync check failed: {}", error);
                }
            });
        }

        Ok(())
    }

    pub async fn replace_settings(&self, settings: CloudSyncSettings) -> AppResult<()> {
        *self.settings.lock().await = settings.clone();
        self.set_status(
            if settings.enabled { "idle" } else { "disabled" },
            String::new(),
            None,
            None,
        )
        .await;
        Ok(())
    }

    pub async fn get_status(&self) -> CloudSyncStatus {
        self.status.lock().await.clone()
    }

    pub async fn list_history(&self) -> Vec<CloudSyncHistoryEntry> {
        let Ok(app) = self.app() else {
            return Vec::new();
        };
        read_cloud_sync_history_from_logs(&app).unwrap_or_default()
    }

    pub async fn notify_config_changed(self: &Arc<Self>) {
        let settings = self.settings.lock().await.clone();
        if !settings.enabled || !settings.auto_push_on_change {
            return;
        }
        self.auto_push_notify.notify_one();
    }

    pub async fn test_connection(&self) -> AppResult<()> {
        let started = Instant::now();
        let settings = self.settings.lock().await.clone();
        let result = async {
            let _ = require_master_password()?;
            let operator = build_operator(&settings)?;
            ensure_remote_layout(&operator, &settings.remote_root).await?;
            let _ = operator
                .exists(&remote_path(&settings.remote_root, SYNC_SNAPSHOTS_DIR))
                .await
                .map_err(map_storage_error)?;
            Ok::<(), AppError>(())
        }
        .await;

        match result {
            Ok(()) => {
                self.append_history(CloudSyncHistoryEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp_ms: current_time_ms(),
                    kind: "sync".to_string(),
                    status: "success".to_string(),
                    trigger: "manual_test_connection".to_string(),
                    provider: Some(settings.provider),
                    revision: None,
                    duration_ms: Some(elapsed_ms(started.elapsed())),
                    message: "Cloud connection verified".to_string(),
                })
                .await;
                Ok(())
            }
            Err(error) => {
                self.record_failure("sync", "manual_test_connection", &error)
                    .await;
                Err(error)
            }
        }
    }

    pub async fn sync_push_now(self: &Arc<Self>, trigger: &str) -> AppResult<()> {
        match self.push_snapshot(trigger, false).await {
            Ok(()) => Ok(()),
            Err(error) => {
                self.record_failure("sync", trigger, &error).await;
                Err(error)
            }
        }
    }

    pub async fn sync_pull_now(self: &Arc<Self>, trigger: &str) -> AppResult<()> {
        match self.pull_snapshot(trigger, false).await {
            Ok(()) => Ok(()),
            Err(error) => {
                self.record_failure("sync", trigger, &error).await;
                Err(error)
            }
        }
    }

    pub async fn run_cloud_backup_now(self: &Arc<Self>, trigger: &str) -> AppResult<()> {
        match self.backup_snapshot(trigger).await {
            Ok(()) => Ok(()),
            Err(error) => {
                self.record_failure("backup", trigger, &error).await;
                Err(error)
            }
        }
    }

    pub async fn resolve_cloud_sync_conflict(self: &Arc<Self>, action: &str) -> AppResult<()> {
        let result = match action {
            "upload_local" => self.push_snapshot("resolve_upload", true).await,
            "download_remote" => self.pull_snapshot("resolve_download", true).await,
            _ => Err(AppError::Config(format!(
                "Unsupported conflict resolution action '{}'",
                action
            ))),
        };

        match result {
            Ok(()) => Ok(()),
            Err(error) => {
                self.record_failure("sync", action, &error).await;
                Err(error)
            }
        }
    }

    pub async fn list_remote_backups(&self) -> AppResult<Vec<RemoteBackupEntry>> {
        let settings = self.settings.lock().await.clone();
        let operator = build_operator(&settings)?;
        let index = load_backup_index(&operator, &settings.remote_root).await?;
        Ok(index.entries)
    }

    pub async fn restore_remote_backup(
        self: &Arc<Self>,
        revision: &str,
        trigger: &str,
    ) -> AppResult<()> {
        let result = self.restore_remote_backup_inner(revision, trigger).await;
        if let Err(error) = &result {
            self.record_failure("backup", trigger, error).await;
        }
        result
    }

    async fn restore_remote_backup_inner(
        self: &Arc<Self>,
        revision: &str,
        trigger: &str,
    ) -> AppResult<()> {
        let _guard = self.operation_lock.lock().await;
        let _ = require_master_password()?;
        let settings = self.settings.lock().await.clone();
        self.set_status(
            "running",
            "Restoring remote backup".to_string(),
            Some("restore_remote_backup".to_string()),
            None,
        )
        .await;
        let started = Instant::now();
        let operator = build_operator(&settings)?;
        let remote_file = remote_path(
            &settings.remote_root,
            &format!("{BACKUPS_SNAPSHOTS_DIR}{revision}.redb.enc"),
        );
        let raw = operator
            .read(&remote_file)
            .await
            .map_err(map_storage_error)?;
        let decrypted = decrypt_snapshot_bytes(raw.to_vec().as_slice())?;
        let envelope = decode_portable_snapshot(&decrypted)?;
        apply_portable_snapshot(&self.app()?, &envelope).await?;

        {
            let mut state = self.state.lock().await;
            state.last_synced_payload_hash = None;
            state.last_applied_remote_revision = None;
            state.last_checked_at_ms = Some(current_time_ms());
            config::save_cloud_sync_state(&self.app()?, &state)?;
        }

        self.append_history(CloudSyncHistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp_ms: current_time_ms(),
            kind: "backup".to_string(),
            status: "success".to_string(),
            trigger: trigger.to_string(),
            provider: Some(settings.provider.clone()),
            revision: Some(revision.to_string()),
            duration_ms: Some(elapsed_ms(started.elapsed())),
            message: "Remote backup restored".to_string(),
        })
        .await;
        self.set_status("idle", "Remote backup restored".to_string(), None, None)
            .await;
        Ok(())
    }

    async fn startup_check(self: &Arc<Self>) -> AppResult<()> {
        let _guard = self.operation_lock.lock().await;
        let settings = self.settings.lock().await.clone();
        if !settings.enabled {
            self.set_status("disabled", String::new(), None, None).await;
            return Ok(());
        }
        let _ = require_master_password()?;
        let operator = build_operator(&settings)?;
        ensure_remote_layout(&operator, &settings.remote_root).await?;

        let local_envelope = {
            let state = self.state.lock().await.clone();
            build_portable_snapshot(&self.app()?, PortableSnapshotKind::Sync, &state.device_id)?
        };
        let local_hash = local_envelope.payload_hash.clone();
        let latest = load_sync_pointer(&operator, &settings.remote_root).await?;

        {
            let mut state = self.state.lock().await;
            state.last_checked_at_ms = Some(current_time_ms());
            config::save_cloud_sync_state(&self.app()?, &state)?;
        }

        let Some(remote) = latest else {
            self.set_status(
                "idle",
                "No remote sync snapshot found".to_string(),
                None,
                None,
            )
            .await;
            return Ok(());
        };

        let state = self.state.lock().await.clone();
        let local_changed = state
            .last_synced_payload_hash
            .as_deref()
            .map_or(true, |hash| hash != local_hash);
        let remote_changed = state
            .last_applied_remote_revision
            .as_deref()
            .map_or(true, |revision| revision != remote.revision_id);

        if remote.payload_hash == local_hash {
            let mut state = self.state.lock().await;
            state.last_synced_payload_hash = Some(local_hash);
            state.last_applied_remote_revision = Some(remote.revision_id.clone());
            state.last_checked_at_ms = Some(current_time_ms());
            config::save_cloud_sync_state(&self.app()?, &state)?;
            self.set_status("idle", "Cloud sync is up to date".to_string(), None, None)
                .await;
            return Ok(());
        }

        if remote_changed && local_changed {
            let conflict = CloudConflictPreview {
                detected_at_ms: current_time_ms(),
                provider: settings.provider.clone(),
                local_payload_hash: local_hash,
                remote_payload_hash: remote.payload_hash.clone(),
                remote_revision: remote.revision_id.clone(),
                remote_created_at_ms: remote.created_at_ms,
                remote_device_id: remote.device_id.clone(),
                message: "Both local and cloud state changed since last sync".to_string(),
            };
            self.append_history(CloudSyncHistoryEntry {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp_ms: current_time_ms(),
                kind: "sync".to_string(),
                status: "conflict".to_string(),
                trigger: "startup_check".to_string(),
                provider: Some(settings.provider.clone()),
                revision: Some(remote.revision_id.clone()),
                duration_ms: None,
                message: conflict.message.clone(),
            })
            .await;
            self.set_status("conflict", conflict.message.clone(), None, Some(conflict))
                .await;
            return Ok(());
        }

        if remote_changed {
            drop(_guard);
            return self.pull_snapshot("startup_check", false).await;
        }

        self.set_status("idle", "Local changes pending sync".to_string(), None, None)
            .await;
        Ok(())
    }

    fn ensure_auto_push_worker(self: &Arc<Self>) {
        if self.auto_push_worker_started.swap(true, Ordering::SeqCst) {
            return;
        }

        let manager = Arc::clone(self);
        async_runtime::spawn(async move {
            loop {
                manager.auto_push_notify.notified().await;

                loop {
                    let debounce_secs = manager.settings.lock().await.sync_debounce_seconds.max(1);
                    tokio::time::sleep(Duration::from_secs(debounce_secs)).await;

                    while tokio::time::timeout(
                        Duration::from_millis(100),
                        manager.auto_push_notify.notified(),
                    )
                    .await
                    .is_ok()
                    {}

                    let settings = manager.settings.lock().await.clone();
                    if settings.enabled && settings.auto_push_on_change {
                        if let Err(error) = manager.sync_push_now("auto_push").await {
                            tracing::warn!("Auto push failed: {}", error);
                        }
                    }

                    let pending_more = tokio::time::timeout(
                        Duration::from_millis(100),
                        manager.auto_push_notify.notified(),
                    )
                    .await
                    .is_ok();
                    if !pending_more {
                        break;
                    }
                }
            }
        });
    }

    fn ensure_backup_worker(self: &Arc<Self>) {
        if self.backup_worker_started.swap(true, Ordering::SeqCst) {
            return;
        }

        let manager = Arc::clone(self);
        async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(BACKUP_CHECK_INTERVAL).await;

                let settings = manager.settings.lock().await.clone();
                if !settings.enabled || !settings.scheduled_backup_enabled {
                    continue;
                }

                let state = manager.state.lock().await.clone();
                let now = current_time_ms();
                let due = state.last_backup_at_ms.map_or(true, |last| {
                    now.saturating_sub(last)
                        >= settings.backup_interval_hours.max(1) * 60 * 60 * 1000
                });
                if !due {
                    continue;
                }

                if let Err(error) = manager.run_cloud_backup_now("scheduled_backup").await {
                    tracing::warn!("Scheduled backup failed: {}", error);
                }
            }
        });
    }

    async fn push_snapshot(self: &Arc<Self>, trigger: &str, force: bool) -> AppResult<()> {
        let _guard = self.operation_lock.lock().await;
        let _ = require_master_password()?;
        let settings = self.settings.lock().await.clone();
        if !settings.enabled {
            return Err(AppError::Config(
                "Cloud sync is disabled in settings".to_string(),
            ));
        }

        self.set_status(
            "running",
            "Uploading cloud sync snapshot".to_string(),
            Some("sync_push".to_string()),
            None,
        )
        .await;

        let started = Instant::now();
        let state_snapshot = self.state.lock().await.clone();
        let operator = build_operator(&settings)?;
        ensure_remote_layout(&operator, &settings.remote_root).await?;

        let envelope = build_portable_snapshot(
            &self.app()?,
            PortableSnapshotKind::Sync,
            &state_snapshot.device_id,
        )?;
        let local_hash = envelope.payload_hash.clone();
        let latest = load_sync_pointer(&operator, &settings.remote_root).await?;

        if let Some(remote) = &latest {
            if remote.payload_hash == local_hash {
                let mut state = self.state.lock().await;
                state.last_synced_payload_hash = Some(local_hash);
                state.last_applied_remote_revision = Some(remote.revision_id.clone());
                state.last_checked_at_ms = Some(current_time_ms());
                config::save_cloud_sync_state(&self.app()?, &state)?;
                self.set_status(
                    "idle",
                    "Cloud sync is already up to date".to_string(),
                    None,
                    None,
                )
                .await;
                return Ok(());
            }
        }

        let remote_changed = latest.as_ref().is_some_and(|remote| {
            state_snapshot
                .last_applied_remote_revision
                .as_deref()
                .map_or(true, |revision| revision != remote.revision_id)
        });
        let local_changed = state_snapshot
            .last_synced_payload_hash
            .as_deref()
            .map_or(true, |hash| hash != local_hash);

        if remote_changed && !force {
            if local_changed {
                let remote = latest.expect("checked above");
                let conflict = CloudConflictPreview {
                    detected_at_ms: current_time_ms(),
                    provider: settings.provider.clone(),
                    local_payload_hash: local_hash.clone(),
                    remote_payload_hash: remote.payload_hash.clone(),
                    remote_revision: remote.revision_id.clone(),
                    remote_created_at_ms: remote.created_at_ms,
                    remote_device_id: remote.device_id.clone(),
                    message: "Both local and cloud state changed since last sync".to_string(),
                };
                self.append_history(CloudSyncHistoryEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp_ms: current_time_ms(),
                    kind: "sync".to_string(),
                    status: "conflict".to_string(),
                    trigger: trigger.to_string(),
                    provider: Some(settings.provider.clone()),
                    revision: Some(remote.revision_id.clone()),
                    duration_ms: Some(elapsed_ms(started.elapsed())),
                    message: conflict.message.clone(),
                })
                .await;
                self.set_status("conflict", conflict.message.clone(), None, Some(conflict))
                    .await;
                return Err(AppError::Config("Cloud sync conflict detected".to_string()));
            }
            return Err(AppError::Config(
                "Remote snapshot is newer than local state. Pull first.".to_string(),
            ));
        }

        let encoded = encode_portable_snapshot(&envelope)?;
        let encrypted = encrypt_snapshot_bytes(&encoded)?;
        let snapshot_path = remote_path(
            &settings.remote_root,
            &format!("{SYNC_SNAPSHOTS_DIR}{}.redb.enc", envelope.revision_id),
        );
        operator
            .write(&snapshot_path, encrypted)
            .await
            .map_err(map_storage_error)?;

        let pointer = RemoteSyncPointer {
            revision_id: envelope.revision_id.clone(),
            created_at_ms: envelope.created_at_ms,
            payload_hash: envelope.payload_hash.clone(),
            device_id: envelope.device_id.clone(),
            app_version: envelope.app_version.clone(),
        };
        write_sync_pointer(&operator, &settings.remote_root, &pointer).await?;

        {
            let mut state = self.state.lock().await;
            state.last_synced_payload_hash = Some(envelope.payload_hash.clone());
            state.last_applied_remote_revision = Some(envelope.revision_id.clone());
            state.last_synced_at_ms = Some(current_time_ms());
            state.last_checked_at_ms = Some(current_time_ms());
            config::save_cloud_sync_state(&self.app()?, &state)?;
        }

        self.append_history(CloudSyncHistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp_ms: current_time_ms(),
            kind: "sync".to_string(),
            status: "success".to_string(),
            trigger: trigger.to_string(),
            provider: Some(settings.provider.clone()),
            revision: Some(envelope.revision_id.clone()),
            duration_ms: Some(elapsed_ms(started.elapsed())),
            message: "Cloud sync snapshot uploaded".to_string(),
        })
        .await;
        self.set_status(
            "idle",
            "Cloud sync snapshot uploaded".to_string(),
            None,
            None,
        )
        .await;
        Ok(())
    }

    async fn pull_snapshot(self: &Arc<Self>, trigger: &str, force: bool) -> AppResult<()> {
        let _guard = self.operation_lock.lock().await;
        let _ = require_master_password()?;
        let settings = self.settings.lock().await.clone();
        if !settings.enabled {
            return Err(AppError::Config(
                "Cloud sync is disabled in settings".to_string(),
            ));
        }

        self.set_status(
            "running",
            "Downloading cloud sync snapshot".to_string(),
            Some("sync_pull".to_string()),
            None,
        )
        .await;

        let started = Instant::now();
        let operator = build_operator(&settings)?;
        let latest = load_sync_pointer(&operator, &settings.remote_root)
            .await?
            .ok_or_else(|| AppError::Config("No remote sync snapshot found".to_string()))?;

        let state_snapshot = self.state.lock().await.clone();
        let local_envelope = build_portable_snapshot(
            &self.app()?,
            PortableSnapshotKind::Sync,
            &state_snapshot.device_id,
        )?;
        let local_changed = state_snapshot
            .last_synced_payload_hash
            .as_deref()
            .map_or(true, |hash| hash != local_envelope.payload_hash);
        let remote_changed = state_snapshot
            .last_applied_remote_revision
            .as_deref()
            .map_or(true, |revision| revision != latest.revision_id);

        if latest.payload_hash == local_envelope.payload_hash {
            let mut state = self.state.lock().await;
            state.last_synced_payload_hash = Some(latest.payload_hash.clone());
            state.last_applied_remote_revision = Some(latest.revision_id.clone());
            state.last_checked_at_ms = Some(current_time_ms());
            config::save_cloud_sync_state(&self.app()?, &state)?;
            self.set_status(
                "idle",
                "Cloud sync is already up to date".to_string(),
                None,
                None,
            )
            .await;
            return Ok(());
        }

        if remote_changed && local_changed && !force {
            let conflict = CloudConflictPreview {
                detected_at_ms: current_time_ms(),
                provider: settings.provider.clone(),
                local_payload_hash: local_envelope.payload_hash.clone(),
                remote_payload_hash: latest.payload_hash.clone(),
                remote_revision: latest.revision_id.clone(),
                remote_created_at_ms: latest.created_at_ms,
                remote_device_id: latest.device_id.clone(),
                message: "Both local and cloud state changed since last sync".to_string(),
            };
            self.append_history(CloudSyncHistoryEntry {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp_ms: current_time_ms(),
                kind: "sync".to_string(),
                status: "conflict".to_string(),
                trigger: trigger.to_string(),
                provider: Some(settings.provider.clone()),
                revision: Some(latest.revision_id.clone()),
                duration_ms: Some(elapsed_ms(started.elapsed())),
                message: conflict.message.clone(),
            })
            .await;
            self.set_status("conflict", conflict.message.clone(), None, Some(conflict))
                .await;
            return Err(AppError::Config("Cloud sync conflict detected".to_string()));
        }

        if !remote_changed && !force {
            return Err(AppError::Config(
                "No newer remote sync snapshot is available".to_string(),
            ));
        }

        let snapshot_path = remote_path(
            &settings.remote_root,
            &format!("{SYNC_SNAPSHOTS_DIR}{}.redb.enc", latest.revision_id),
        );
        let raw = operator
            .read(&snapshot_path)
            .await
            .map_err(map_storage_error)?;
        let decrypted = decrypt_snapshot_bytes(raw.to_vec().as_slice())?;
        let envelope = decode_portable_snapshot(&decrypted)?;
        apply_portable_snapshot(&self.app()?, &envelope).await?;

        {
            let mut state = self.state.lock().await;
            state.last_synced_payload_hash = Some(envelope.payload_hash.clone());
            state.last_applied_remote_revision = Some(envelope.revision_id.clone());
            state.last_synced_at_ms = Some(current_time_ms());
            state.last_checked_at_ms = Some(current_time_ms());
            config::save_cloud_sync_state(&self.app()?, &state)?;
        }

        self.append_history(CloudSyncHistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp_ms: current_time_ms(),
            kind: "sync".to_string(),
            status: "success".to_string(),
            trigger: trigger.to_string(),
            provider: Some(settings.provider.clone()),
            revision: Some(envelope.revision_id.clone()),
            duration_ms: Some(elapsed_ms(started.elapsed())),
            message: "Cloud sync snapshot downloaded".to_string(),
        })
        .await;
        self.set_status(
            "idle",
            "Cloud sync snapshot downloaded".to_string(),
            None,
            None,
        )
        .await;
        Ok(())
    }

    async fn backup_snapshot(self: &Arc<Self>, trigger: &str) -> AppResult<()> {
        let _guard = self.operation_lock.lock().await;
        let _ = require_master_password()?;
        let settings = self.settings.lock().await.clone();
        if !settings.enabled {
            return Err(AppError::Config(
                "Cloud sync is disabled in settings".to_string(),
            ));
        }

        self.set_status(
            "running",
            "Uploading cloud backup".to_string(),
            Some("backup".to_string()),
            None,
        )
        .await;

        let started = Instant::now();
        let state_snapshot = self.state.lock().await.clone();
        let operator = build_operator(&settings)?;
        ensure_remote_layout(&operator, &settings.remote_root).await?;

        let envelope = build_portable_snapshot(
            &self.app()?,
            PortableSnapshotKind::Backup,
            &state_snapshot.device_id,
        )?;
        let encoded = encode_portable_snapshot(&envelope)?;
        let encrypted = encrypt_snapshot_bytes(&encoded)?;
        let snapshot_path = remote_path(
            &settings.remote_root,
            &format!("{BACKUPS_SNAPSHOTS_DIR}{}.redb.enc", envelope.revision_id),
        );
        operator
            .write(&snapshot_path, encrypted)
            .await
            .map_err(map_storage_error)?;

        let mut index = load_backup_index(&operator, &settings.remote_root).await?;
        index.entries.insert(
            0,
            RemoteBackupEntry {
                revision: envelope.revision_id.clone(),
                created_at_ms: envelope.created_at_ms,
                payload_hash: envelope.payload_hash.clone(),
                device_id: envelope.device_id.clone(),
                app_version: envelope.app_version.clone(),
                message: format!("Backup from {}", settings.device_name),
            },
        );

        let overflow: Vec<RemoteBackupEntry> = index
            .entries
            .iter()
            .skip(settings.backup_retention_count)
            .cloned()
            .collect();
        index.entries.truncate(settings.backup_retention_count);

        write_backup_index(&operator, &settings.remote_root, &index).await?;

        for old in overflow {
            let old_path = remote_path(
                &settings.remote_root,
                &format!("{BACKUPS_SNAPSHOTS_DIR}{}.redb.enc", old.revision),
            );
            let _ = operator.delete(&old_path).await;
        }

        {
            let mut state = self.state.lock().await;
            state.last_backup_revision = Some(envelope.revision_id.clone());
            state.last_backup_at_ms = Some(current_time_ms());
            config::save_cloud_sync_state(&self.app()?, &state)?;
        }

        self.append_history(CloudSyncHistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp_ms: current_time_ms(),
            kind: "backup".to_string(),
            status: "success".to_string(),
            trigger: trigger.to_string(),
            provider: Some(settings.provider.clone()),
            revision: Some(envelope.revision_id.clone()),
            duration_ms: Some(elapsed_ms(started.elapsed())),
            message: "Cloud backup uploaded".to_string(),
        })
        .await;
        self.set_status("idle", "Cloud backup uploaded".to_string(), None, None)
            .await;
        Ok(())
    }

    async fn append_history(&self, entry: CloudSyncHistoryEntry) {
        let Ok(app) = self.app() else {
            return;
        };
        log_history_entry(&entry);
        let snapshot = read_cloud_sync_history_from_logs(&app).unwrap_or_default();
        let _ = app.emit("cloud-sync-history-changed", &snapshot);
    }

    async fn record_failure(&self, kind: &str, trigger: &str, error: &AppError) {
        let status = self.status.lock().await.clone();
        if status.state == "conflict" {
            return;
        }

        let provider = self.settings.lock().await.provider.clone();
        let message = error.to_string();

        self.append_history(CloudSyncHistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp_ms: current_time_ms(),
            kind: kind.to_string(),
            status: "failed".to_string(),
            trigger: trigger.to_string(),
            provider: Some(provider),
            revision: None,
            duration_ms: None,
            message: message.clone(),
        })
        .await;
        self.set_status("failed", message, status.current_operation, status.conflict)
            .await;
    }

    async fn set_status(
        &self,
        state_value: &str,
        message: String,
        current_operation: Option<String>,
        conflict: Option<CloudConflictPreview>,
    ) {
        let Ok(app) = self.app() else {
            return;
        };
        let settings = self.settings.lock().await.clone();
        let state = self.state.lock().await.clone();
        let status = CloudSyncStatus {
            enabled: settings.enabled,
            provider: settings.provider.clone(),
            state: state_value.to_string(),
            message,
            current_operation,
            last_checked_at_ms: state.last_checked_at_ms,
            last_synced_at_ms: state.last_synced_at_ms,
            last_backup_at_ms: state.last_backup_at_ms,
            conflict: conflict.clone(),
        };
        *self.status.lock().await = status.clone();
        let _ = app.emit("cloud-sync-status-changed", &status);
        let _ = app.emit("cloud-sync-conflict", &conflict);
        crate::tray::schedule_refresh(&app);
    }

    fn app(&self) -> AppResult<tauri::AppHandle> {
        self.app_handle
            .get()
            .cloned()
            .ok_or_else(|| AppError::Config("cloud sync app handle is not initialized".to_string()))
    }
}

fn build_operator(settings: &CloudSyncSettings) -> AppResult<Operator> {
    match settings.provider.as_str() {
        "webdav" => {
            let mut builder = Webdav::default().endpoint(&settings.webdav.endpoint);
            if !settings.webdav.root.trim().is_empty() {
                builder = builder.root(&settings.webdav.root);
            }
            if !settings.webdav.username.trim().is_empty() {
                builder = builder.username(&settings.webdav.username);
            }
            if let Some(password) = settings
                .webdav
                .password
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                builder = builder.password(password);
            }
            Ok(Operator::new(builder)
                .map_err(map_storage_error)?
                .layer(
                    TimeoutLayer::new()
                        .with_timeout(Duration::from_secs(30))
                        .with_io_timeout(Duration::from_secs(30)),
                )
                .layer(RetryLayer::new().with_max_times(3))
                .layer(TracingLayer)
                .finish())
        }
        "s3" => {
            let mut builder = S3::default().bucket(&settings.s3.bucket);
            if !settings.s3.endpoint.trim().is_empty() {
                builder = builder.endpoint(&settings.s3.endpoint);
            }
            if !settings.s3.region.trim().is_empty() {
                builder = builder.region(&settings.s3.region);
            }
            if !settings.s3.root.trim().is_empty() {
                builder = builder.root(&settings.s3.root);
            }
            if let Some(access_key_id) = settings
                .s3
                .access_key_id
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                builder = builder.access_key_id(access_key_id);
            }
            if let Some(secret_access_key) = settings
                .s3
                .secret_access_key
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                builder = builder.secret_access_key(secret_access_key);
            }
            if let Some(session_token) = settings
                .s3
                .session_token
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                builder = builder.session_token(session_token);
            }
            if settings.s3.virtual_host_style {
                builder = builder.enable_virtual_host_style();
            }
            Ok(Operator::new(builder)
                .map_err(map_storage_error)?
                .layer(
                    TimeoutLayer::new()
                        .with_timeout(Duration::from_secs(30))
                        .with_io_timeout(Duration::from_secs(30)),
                )
                .layer(RetryLayer::new().with_max_times(3))
                .layer(TracingLayer)
                .finish())
        }
        other => Err(AppError::Config(format!(
            "Unsupported cloud provider '{}'",
            other
        ))),
    }
}

async fn ensure_remote_layout(op: &Operator, base_root: &str) -> AppResult<()> {
    op.create_dir(&remote_path(base_root, SYNC_SNAPSHOTS_DIR))
        .await
        .map_err(map_storage_error)?;
    op.create_dir(&remote_path(base_root, BACKUPS_SNAPSHOTS_DIR))
        .await
        .map_err(map_storage_error)?;
    Ok(())
}

async fn load_sync_pointer(op: &Operator, base_root: &str) -> AppResult<Option<RemoteSyncPointer>> {
    let path = remote_path(base_root, SYNC_LATEST_FILE);
    if !op.exists(&path).await.map_err(map_storage_error)? {
        return Ok(None);
    }
    let raw = op.read(&path).await.map_err(map_storage_error)?;
    decode_redb_json_doc(
        raw.to_vec().as_slice(),
        REMOTE_SYNC_POINTER_TABLE,
        REMOTE_SYNC_POINTER_KEY,
    )
    .map(Some)
}

async fn write_sync_pointer(
    op: &Operator,
    base_root: &str,
    pointer: &RemoteSyncPointer,
) -> AppResult<()> {
    let encoded =
        encode_redb_json_doc(REMOTE_SYNC_POINTER_TABLE, REMOTE_SYNC_POINTER_KEY, pointer)?;
    op.write(&remote_path(base_root, SYNC_LATEST_FILE), encoded)
        .await
        .map_err(map_storage_error)?;
    Ok(())
}

async fn load_backup_index(op: &Operator, base_root: &str) -> AppResult<RemoteBackupIndex> {
    let path = remote_path(base_root, BACKUPS_INDEX_FILE);
    if !op.exists(&path).await.map_err(map_storage_error)? {
        return Ok(RemoteBackupIndex {
            version: config::CLOUD_SYNC_HISTORY_VERSION,
            entries: Vec::new(),
        });
    }
    let raw = op.read(&path).await.map_err(map_storage_error)?;
    decode_redb_json_doc(
        raw.to_vec().as_slice(),
        REMOTE_BACKUP_INDEX_TABLE,
        REMOTE_BACKUP_INDEX_KEY,
    )
}

async fn write_backup_index(
    op: &Operator,
    base_root: &str,
    index: &RemoteBackupIndex,
) -> AppResult<()> {
    let encoded = encode_redb_json_doc(REMOTE_BACKUP_INDEX_TABLE, REMOTE_BACKUP_INDEX_KEY, index)?;
    op.write(&remote_path(base_root, BACKUPS_INDEX_FILE), encoded)
        .await
        .map_err(map_storage_error)?;
    Ok(())
}

fn encode_redb_json_doc<T: Serialize>(
    table: TableDefinition<&str, &str>,
    key: &str,
    value: &T,
) -> AppResult<Vec<u8>> {
    let temp = TempRedbFile::new("cloud-meta-encode");
    {
        let db = Database::create(temp.path()).map_err(storage_error)?;
        let txn = db.begin_write().map_err(storage_error)?;
        {
            let mut docs = txn.open_table(table).map_err(storage_error)?;
            let content = serde_json::to_string(value)?;
            docs.insert(key, content.as_str()).map_err(storage_error)?;
        }
        txn.commit().map_err(storage_error)?;
    }
    std::fs::read(temp.path()).map_err(Into::into)
}

fn decode_redb_json_doc<T: DeserializeOwned>(
    bytes: &[u8],
    table: TableDefinition<&str, &str>,
    key: &str,
) -> AppResult<T> {
    let temp = TempRedbFile::new("cloud-meta-decode");
    std::fs::write(temp.path(), bytes)?;
    let content = {
        let db = Database::open(temp.path()).map_err(storage_error)?;
        let read = db.begin_read().map_err(storage_error)?;
        let docs = read.open_table(table).map_err(storage_error)?;
        docs.get(key)
            .map_err(storage_error)?
            .ok_or_else(|| AppError::Config("remote redb metadata is missing".to_string()))?
            .value()
            .to_string()
    };
    serde_json::from_str(&content).map_err(Into::into)
}

fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(format!("Storage error: {error}"))
}

fn remote_path(base_root: &str, child: &str) -> String {
    let root = base_root.trim().trim_matches('/');
    let child = child.trim().trim_start_matches('/');
    if root.is_empty() {
        child.to_string()
    } else if child.is_empty() {
        root.to_string()
    } else {
        format!("{root}/{child}")
    }
}

fn current_time_ms() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

fn elapsed_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn map_storage_error(error: opendal::Error) -> AppError {
    let raw = error.to_string();
    if let Some(message) = map_webdav_auth_error(&raw) {
        return AppError::Config(message);
    }

    let label = match error.kind() {
        ErrorKind::NotFound => "not found",
        ErrorKind::PermissionDenied => "permission denied",
        ErrorKind::ConfigInvalid => "invalid config",
        ErrorKind::Unsupported => "unsupported",
        ErrorKind::RateLimited => "rate limited",
        _ => "unexpected error",
    };
    AppError::Config(format!("cloud storage {label}: {raw}"))
}

fn map_webdav_auth_error(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    let is_webdav = lower.contains("service: webdav");
    let is_unauthorized = lower.contains("status: 401") || lower.contains("401 unauthorized");

    if is_webdav && is_unauthorized {
        return Some(
            "WebDAV authentication failed (401 Unauthorized). NyaTerm currently supports WebDAV Basic/Bearer authentication only and does not support Apache Digest auth. If you are using bytemark/webdav, change AUTH_TYPE to Basic and prefer HTTPS; otherwise verify the username and password."
                .to_string(),
        );
    }

    None
}

fn log_history_entry(entry: &CloudSyncHistoryEntry) {
    observability::log_event(StructuredLog {
        level: history_log_level(entry.status.as_str()),
        domain: HISTORY_LOG_DOMAIN.to_string(),
        event: HISTORY_LOG_EVENT.to_string(),
        message: entry.message.clone(),
        ids: Some(serde_json::json!({ "history_id": entry.id })),
        data: Some(serde_json::json!({
            "id": entry.id,
            "timestamp_ms": entry.timestamp_ms,
            "kind": entry.kind,
            "status": entry.status,
            "trigger": entry.trigger,
            "provider": entry.provider,
            "revision": entry.revision,
            "duration_ms": entry.duration_ms,
        })),
        error: None,
        client_timestamp: None,
    });
}

fn history_log_level(status: &str) -> StructuredLogLevel {
    match status {
        "failed" => StructuredLogLevel::Error,
        "conflict" => StructuredLogLevel::Warn,
        _ => StructuredLogLevel::Info,
    }
}

fn read_cloud_sync_history_from_logs(
    app: &tauri::AppHandle,
) -> AppResult<Vec<CloudSyncHistoryEntry>> {
    let retention_days = config::load_app_settings(app)
        .map(|settings| settings.diagnostics.retention_days)
        .unwrap_or(7);
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| AppError::Config(error.to_string()))?;
    let mut entries = Vec::new();

    for path in collect_cloud_sync_log_files(&log_dir, retention_days)? {
        let file = match std::fs::File::open(&path) {
            Ok(file) => file,
            Err(_) => continue,
        };
        let reader = BufReader::new(file);

        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(entry) = parse_history_entry(value) {
                entries.push(entry);
            }
        }
    }

    entries.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
    if entries.len() > HISTORY_LIMIT {
        entries.truncate(HISTORY_LIMIT);
    }
    Ok(entries)
}

fn collect_cloud_sync_log_files(log_dir: &Path, retention_days: u32) -> AppResult<Vec<PathBuf>> {
    let min_modified = SystemTime::now()
        .checked_sub(Duration::from_secs(
            u64::from(retention_days.max(1)) * 24 * 60 * 60,
        ))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut files = Vec::new();

    for entry in std::fs::read_dir(log_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !is_cloud_sync_log_file(&path) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        if modified < min_modified {
            continue;
        }
        files.push(path);
    }

    files.sort();
    Ok(files)
}

fn is_cloud_sync_log_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.starts_with(LOG_FILE_PREFIX) && value.ends_with(LOG_FILE_SUFFIX))
}

fn parse_history_entry(value: Value) -> Option<CloudSyncHistoryEntry> {
    let root = value.as_object()?;
    if root.get("domain")?.as_str()? != HISTORY_LOG_DOMAIN {
        return None;
    }
    if root.get("event")?.as_str()? != HISTORY_LOG_EVENT {
        return None;
    }

    let data = root.get("data")?.as_object()?;
    Some(CloudSyncHistoryEntry {
        id: data.get("id")?.as_str()?.to_string(),
        timestamp_ms: data.get("timestamp_ms")?.as_u64()?,
        kind: data.get("kind")?.as_str()?.to_string(),
        status: data.get("status")?.as_str()?.to_string(),
        trigger: data.get("trigger")?.as_str()?.to_string(),
        provider: data
            .get("provider")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        revision: data
            .get("revision")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        duration_ms: data.get("duration_ms").and_then(Value::as_u64),
        message: root.get("message")?.as_str()?.to_string(),
    })
}

pub async fn notify_config_changed(app: &tauri::AppHandle) {
    let manager = app.state::<Arc<CloudSyncManager>>();
    manager.inner().notify_config_changed().await;
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
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decode_redb_json_doc, encode_redb_json_doc, map_webdav_auth_error, remote_path,
        CloudSyncManager, RemoteSyncPointer, REMOTE_SYNC_POINTER_KEY, REMOTE_SYNC_POINTER_TABLE,
    };
    use crate::config::{CloudSyncSettings, S3SyncSettings, WebdavSyncSettings};

    #[test]
    fn remote_path_joins_without_duplicate_slashes() {
        assert_eq!(
            remote_path("nyaterm", "sync/latest.redb"),
            "nyaterm/sync/latest.redb"
        );
        assert_eq!(
            remote_path("/nyaterm/", "/sync/latest.redb"),
            "nyaterm/sync/latest.redb"
        );
        assert_eq!(remote_path("", "sync/latest.redb"), "sync/latest.redb");
    }

    #[test]
    fn remote_redb_metadata_roundtrips() {
        let pointer = RemoteSyncPointer {
            revision_id: "rev".to_string(),
            created_at_ms: 1,
            payload_hash: "hash".to_string(),
            device_id: "dev".to_string(),
            app_version: "1.0.0".to_string(),
        };
        let encoded =
            encode_redb_json_doc(REMOTE_SYNC_POINTER_TABLE, REMOTE_SYNC_POINTER_KEY, &pointer)
                .expect("encode pointer");
        let decoded: RemoteSyncPointer =
            decode_redb_json_doc(&encoded, REMOTE_SYNC_POINTER_TABLE, REMOTE_SYNC_POINTER_KEY)
                .expect("decode pointer");

        assert_eq!(decoded.revision_id, pointer.revision_id);
        assert_eq!(decoded.payload_hash, pointer.payload_hash);
    }

    #[test]
    fn default_manager_constructs() {
        let _ = CloudSyncManager::new();
    }

    #[test]
    fn cloud_sync_settings_support_both_provider_shapes() {
        let mut settings = CloudSyncSettings::default();
        settings.provider = "webdav".to_string();
        settings.webdav = WebdavSyncSettings {
            endpoint: "https://dav.example.com".to_string(),
            root: "/nyaterm".to_string(),
            username: "user".to_string(),
            password: Some("cipher".to_string()),
        };
        settings.s3 = S3SyncSettings {
            endpoint: "https://s3.example.com".to_string(),
            bucket: "bucket".to_string(),
            region: "auto".to_string(),
            root: "/nyaterm".to_string(),
            access_key_id: Some("cipher".to_string()),
            secret_access_key: Some("cipher".to_string()),
            session_token: None,
            virtual_host_style: true,
        };

        assert_eq!(settings.provider, "webdav");
        assert!(settings.webdav.password.is_some());
        assert!(settings.s3.secret_access_key.is_some());
    }

    #[test]
    fn webdav_401_error_reports_digest_hint() {
        let message = map_webdav_auth_error(
            "Unexpected (persistent) at stat, context: { service: webdav, response: Parts { status: 401 } } => 401 Unauthorized",
        );

        assert!(message.is_some());
        assert!(message
            .unwrap()
            .contains("does not support Apache Digest auth"));
    }

    #[test]
    fn non_webdav_error_does_not_report_digest_hint() {
        let message = map_webdav_auth_error(
            "Unexpected (persistent) at stat, context: { service: s3, response: Parts { status: 401 } } => 401 Unauthorized",
        );

        assert!(message.is_none());
    }
}
