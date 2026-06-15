use tauri::AppHandle;

use crate::config;
use crate::error::{AppError, AppResult};
use crate::utils::crypto::get_master_password;

use super::cloud_sync::crypto::{decrypt_snapshot_bytes, encrypt_snapshot_bytes};
use super::portable_snapshot::{
    PortableSnapshotKind, apply_portable_snapshot, build_portable_snapshot,
    decode_portable_snapshot, encode_portable_snapshot,
};

pub async fn export_config(app: &AppHandle, output_path: &str) -> AppResult<()> {
    let _ = get_master_password()
        .ok_or_else(|| AppError::Config("master password is not set".into()))?;
    let state = config::load_cloud_sync_state(app).unwrap_or_default();
    let envelope = build_portable_snapshot(app, PortableSnapshotKind::Backup, &state.device_id)?;
    let encoded = encode_portable_snapshot(&envelope)?;
    let encrypted = encrypt_snapshot_bytes(&encoded)?;
    std::fs::write(output_path, encrypted)?;
    Ok(())
}

pub async fn import_config(app: &AppHandle, file_path: &str) -> AppResult<()> {
    let raw = std::fs::read(file_path)?;
    let decoded = decrypt_snapshot_bytes(&raw)?;
    let envelope = decode_portable_snapshot(&decoded)?;
    apply_portable_snapshot(app, &envelope).await?;

    let mut state = config::load_cloud_sync_state(app).unwrap_or_default();
    state.last_synced_payload_hash = None;
    state.last_applied_remote_revision = None;
    config::save_cloud_sync_state(app, &state)?;
    if let Ok(settings) = crate::config::load_app_settings(app) {
        if let Some(ref ct) = settings.security.master_password {
            if let Ok(plain) = crate::utils::crypto::decrypt_settings_secret(ct) {
                crate::utils::crypto::set_master_password(Some(plain));
            }
        }
    }

    Ok(())
}
