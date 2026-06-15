use crate::core::SessionManager;
use crate::core::ssh::SshConnectionHandles;
use crate::core::stats::{RemoteStats, SYSINFO_SCRIPT, parse_stats_output};
use crate::error::{AppError, AppResult};
use std::sync::Arc;
use std::time::Duration;

#[tauri::command]
pub async fn get_remote_stats(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<RemoteStats> {
    use russh::ChannelMsg;

    let ssh_handle = {
        let sessions = state.sessions.lock().await;
        let session = sessions.get(&session_id).ok_or_else(|| {
            AppError::SessionNotFound(format!("Session '{}' not found", session_id))
        })?;

        session
            .ssh_handle
            .as_ref()
            .ok_or_else(|| AppError::Config("Not an SSH session".to_string()))?
            .clone()
            .downcast::<SshConnectionHandles>()
            .map_err(|_| AppError::Config("Failed to get SSH handle".to_string()))?
    };
    let handle_mtx = ssh_handle.target_handle();

    let output = tokio::time::timeout(Duration::from_secs(15), async {
        let mut channel = {
            let handle = handle_mtx.lock().await;
            handle
                .channel_open_session()
                .await
                .map_err(|e| AppError::Channel(format!("Failed to open channel: {}", e)))?
        };

        channel
            .exec(true, SYSINFO_SCRIPT)
            .await
            .map_err(|e| AppError::Channel(format!("Failed to execute stats command: {}", e)))?;

        let mut buf = String::new();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { ref data }) => {
                    buf.push_str(&String::from_utf8_lossy(data));
                }
                Some(ChannelMsg::Eof) | None => break,
                _ => {}
            }
        }

        Ok::<String, AppError>(buf)
    })
    .await
    .map_err(|_| AppError::Channel("Stats command timed out".to_string()))??;

    Ok(parse_stats_output(&output))
}

#[tauri::command]
pub async fn get_terminal_cwd(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<String> {
    let cwd_arc = {
        let sessions = state.sessions.lock().await;
        let session = sessions.get(&session_id).ok_or_else(|| {
            AppError::SessionNotFound(format!("Session '{}' not found", session_id))
        })?;
        session.cwd.clone()
    };

    let cached = cwd_arc.lock().await;
    if let Some(cwd) = cached.as_ref() {
        return Ok(cwd.clone());
    }

    Err(AppError::Config(
        "Working directory is not available for this session. Terminal path sync is only available when the backend receives directory updates from the session.".to_string(),
    ))
}
