use crate::core::translate::{TranslateResult, translate};
use crate::error::AppResult;

#[tauri::command]
pub async fn translate_text(
    app: tauri::AppHandle,
    provider: String,
    text: String,
    target_language: String,
) -> AppResult<TranslateResult> {
    let settings = crate::config::load_app_settings(&app)?;
    let fallback = if settings.translation.target_language.is_empty() {
        "zh-CN".to_string()
    } else {
        settings.translation.target_language.clone()
    };
    let target = if target_language.is_empty() {
        &fallback
    } else {
        &target_language
    };
    translate(&provider, &text, target, &settings.translation).await
}
