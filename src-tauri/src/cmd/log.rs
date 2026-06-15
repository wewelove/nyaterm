use std::sync::Arc;

use crate::core::SessionManager;
use crate::core::ssh::TunnelManager;
use crate::error::AppResult;
use crate::observability::{self, FrontendLogEntry};

#[tauri::command]
pub fn append_frontend_logs(entries: Vec<FrontendLogEntry>) -> AppResult<()> {
    for entry in entries {
        observability::log_event(observability::frontend_log_to_structured(entry));
    }
    Ok(())
}

#[tauri::command]
pub fn export_diagnostics(
    app: tauri::AppHandle,
    session_manager: tauri::State<'_, Arc<SessionManager>>,
    tunnel_manager: tauri::State<'_, Arc<TunnelManager>>,
    output_path: String,
) -> AppResult<()> {
    observability::export_diagnostics(
        &app,
        session_manager.inner().as_ref(),
        tunnel_manager.inner().as_ref(),
        &output_path,
    )
}
