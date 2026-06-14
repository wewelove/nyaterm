use crate::core::SessionManager;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, oneshot};

const DUPLICATE_PROMPT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DuplicateChoice {
    Skip,
    Overwrite,
}

impl DuplicateChoice {
    pub fn from_action(action: &str) -> Option<Self> {
        match action {
            "skip" => Some(Self::Skip),
            "overwrite" => Some(Self::Overwrite),
            _ => None,
        }
    }
}

/// Manages pending duplicate-file prompts awaiting user input from the frontend.
pub struct TransferDuplicateManager {
    pending: Mutex<HashMap<String, oneshot::Sender<DuplicateChoice>>>,
}

impl TransferDuplicateManager {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    pub async fn register(&self, request_id: String) -> oneshot::Receiver<DuplicateChoice> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(request_id, tx);
        rx
    }

    pub async fn respond(&self, request_id: &str, choice: DuplicateChoice) -> bool {
        if let Some(tx) = self.pending.lock().await.remove(request_id) {
            tx.send(choice).is_ok()
        } else {
            false
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDuplicateRequestPayload {
    pub request_id: String,
    pub session_id: String,
    pub remote_path: String,
    pub file_name: String,
    pub is_directory: bool,
    pub target_window_label: Option<String>,
}

pub async fn prompt_duplicate_choice(
    app: &AppHandle,
    session_manager: &SessionManager,
    session_id: &str,
    remote_path: &str,
    file_name: &str,
    is_directory: bool,
) -> AppResult<DuplicateChoice> {
    let manager = app
        .try_state::<Arc<TransferDuplicateManager>>()
        .ok_or_else(|| AppError::Config("TransferDuplicateManager not available".to_string()))?;

    let target_window_label = session_manager
        .session_info(session_id)
        .await
        .ok()
        .and_then(|info| info.owner_window_label);

    let request_id = uuid::Uuid::new_v4().to_string();
    let rx = manager.register(request_id.clone()).await;

    let _ = app.emit(
        "transfer-duplicate-request",
        TransferDuplicateRequestPayload {
            request_id,
            session_id: session_id.to_string(),
            remote_path: remote_path.to_string(),
            file_name: file_name.to_string(),
            is_directory,
            target_window_label,
        },
    );

    match tokio::time::timeout(DUPLICATE_PROMPT_TIMEOUT, rx).await {
        Ok(Ok(choice)) => Ok(choice),
        _ => Ok(DuplicateChoice::Skip),
    }
}
