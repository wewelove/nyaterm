use crate::core::SessionManager;
use crate::core::gpu::{GPU_OVERVIEW_SCRIPT, RemoteGpuOverview, parse_gpu_overview_output};
use crate::core::remote_exec::{ensure_success, exec_ssh_session_command};
use crate::error::AppResult;
use std::sync::Arc;
use std::time::Duration;

const GPU_TIMEOUT: Duration = Duration::from_secs(15);

#[tauri::command]
pub async fn get_remote_gpu_overview(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<RemoteGpuOverview> {
    let output = exec_ssh_session_command(
        state.inner(),
        &session_id,
        GPU_OVERVIEW_SCRIPT.as_bytes(),
        GPU_TIMEOUT,
    )
    .await?;
    let output = ensure_success(output, "Failed to fetch GPU overview")?;

    Ok(parse_gpu_overview_output(&output.stdout))
}
