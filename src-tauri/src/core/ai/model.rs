use std::collections::BTreeMap;
use std::time::Duration;

use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client, ModelIden, WebConfig};
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde_json::Value;

use crate::config::{
    self, AI_REQUEST_USER_AGENT_DEFAULT, AiModelConfigItem, AiModelSource, AiProviderCredential,
    AiProviderKind, AiSettings, ai_model_id_for_credential,
};
use crate::error::{AppError, AppResult};
use crate::utils::url::{join_api_base_url, normalize_api_base_url};

use super::types::{AiChatRequest, AiModelDiscovery};

#[derive(Debug, Clone)]
pub(super) struct ResolvedAiModel {
    pub model_name: String,
    pub provider_kind: AiProviderKind,
    pub credential: Option<AiProviderCredential>,
}

pub(super) fn resolve_request_model(
    settings: &AiSettings,
    request: &AiChatRequest,
) -> AppResult<ResolvedAiModel> {
    tracing::debug!(
        requested_model_id = ?request.model_id,
        default_model_id = ?settings.default_model_id,
        enabled_model_count = settings.models.iter().filter(|model| model.enabled).count(),
        "Resolving AI model for request"
    );

    let selected_model = request
        .model_id
        .as_deref()
        .and_then(|id| {
            settings
                .models
                .iter()
                .find(|model| model.enabled && model.id == id)
        })
        .or_else(|| {
            settings.default_model_id.as_deref().and_then(|id| {
                settings
                    .models
                    .iter()
                    .find(|model| model.enabled && model.id == id)
            })
        })
        .or_else(|| settings.models.iter().find(|model| model.enabled))
        .ok_or_else(|| AppError::Config("No enabled AI model configured".to_string()))?;

    let model_provider_kind = selected_model
        .provider_kind
        .clone()
        .or_else(|| infer_provider_kind_from_model_id(&selected_model.id));

    let credential =
        resolve_model_credential(settings, selected_model, model_provider_kind.as_ref())?;
    let provider_kind = credential
        .as_ref()
        .map(|credential| credential.provider_kind.clone())
        .or(model_provider_kind)
        .ok_or_else(|| {
            AppError::Config(format!(
                "AI model '{}' is missing provider information",
                selected_model.name
            ))
        })?;
    validate_model_credential(&provider_kind, credential.as_ref())?;

    tracing::info!(
        requested_model_id = ?request.model_id,
        resolved_model_id = %selected_model.id,
        resolved_model_name = %selected_model.name,
        provider_kind = ?provider_kind,
        credential_id = ?credential.as_ref().map(|item| item.id.as_str()),
        "Resolved AI model"
    );

    Ok(ResolvedAiModel {
        model_name: selected_model.name.clone(),
        provider_kind,
        credential,
    })
}

fn infer_provider_kind_from_model_id(model_id: &str) -> Option<AiProviderKind> {
    let (prefix, _) = model_id.split_once(':')?;
    match prefix {
        "openai" => Some(AiProviderKind::Openai),
        "anthropic" => Some(AiProviderKind::Anthropic),
        "gemini" => Some(AiProviderKind::Gemini),
        "deepseek" => Some(AiProviderKind::Deepseek),
        "groq" => Some(AiProviderKind::Groq),
        "ollama" => Some(AiProviderKind::Ollama),
        "xai" => Some(AiProviderKind::Xai),
        "cohere" => Some(AiProviderKind::Cohere),
        "mimo" => Some(AiProviderKind::Mimo),
        "zai" => Some(AiProviderKind::Zai),
        "openai_compatible" => Some(AiProviderKind::OpenaiCompatible),
        _ => None,
    }
}

fn resolve_model_credential(
    settings: &AiSettings,
    model: &AiModelConfigItem,
    provider_kind: Option<&AiProviderKind>,
) -> AppResult<Option<AiProviderCredential>> {
    if let Some(credential_id) = model.credential_id.as_deref() {
        let credential = settings
            .provider_credentials
            .iter()
            .find(|item| item.id == credential_id && item.enabled)
            .cloned()
            .ok_or_else(|| {
                AppError::Config(format!(
                    "No enabled AI credential found for model '{}'",
                    model.name
                ))
            })?;
        return Ok(Some(credential));
    }

    Ok(provider_kind.and_then(|provider_kind| {
        settings
            .provider_credentials
            .iter()
            .find(|item| item.enabled && &item.provider_kind == provider_kind)
            .cloned()
    }))
}

fn validate_model_credential(
    provider_kind: &AiProviderKind,
    credential: Option<&AiProviderCredential>,
) -> AppResult<()> {
    match provider_kind {
        AiProviderKind::Ollama => Ok(()),
        AiProviderKind::OpenaiCompatible => {
            if credential.is_none() {
                return Err(AppError::Config(
                    "No enabled OpenAI-compatible AI credential configured".to_string(),
                ));
            }
            Ok(())
        }
        _ => {
            let credential = credential.ok_or_else(|| {
                AppError::Config(format!(
                    "No enabled AI credential configured for {:?}",
                    provider_kind
                ))
            })?;
            if credential
                .api_key
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
            {
                return Err(AppError::Config(format!(
                    "No API key configured for AI credential '{}'",
                    credential.name
                )));
            }
            Ok(())
        }
    }
}

pub(super) fn build_client(model: &ResolvedAiModel, settings: &AiSettings) -> AppResult<Client> {
    tracing::debug!(
        model_name = %model.model_name,
        provider_kind = ?model.provider_kind,
        has_credential = model.credential.is_some(),
        has_base_url = model
            .credential
            .as_ref()
            .and_then(|credential| credential.base_url.as_deref())
            .is_some_and(|value| !value.trim().is_empty()),
        "Building AI client"
    );

    let adapter_kind = adapter_kind(&model.provider_kind);
    let mapped_model = model.model_name.clone();
    let api_key = model
        .credential
        .as_ref()
        .and_then(|credential| credential.api_key.clone())
        .filter(|value| !value.trim().is_empty());
    let base_url = model
        .credential
        .as_ref()
        .and_then(|credential| credential.base_url.as_deref())
        .map(normalize_api_base_url)
        .transpose()?
        .filter(|value| !value.trim().is_empty());

    let resolver =
        ServiceTargetResolver::from_resolver_fn(move |service_target: genai::ServiceTarget| {
            let mut service_target = service_target;
            if let Some(api_key) = api_key.clone() {
                service_target.auth = AuthData::from_single(api_key);
            }
            if let Some(base_url) = base_url.clone() {
                service_target.endpoint = Endpoint::from_owned(base_url);
            }
            Ok(service_target)
        });

    let web_config = WebConfig::default().with_default_headers(ai_request_headers(settings)?);

    Ok(Client::builder()
        .with_model_mapper_fn(move |_model| Ok(ModelIden::new(adapter_kind, mapped_model.clone())))
        .with_service_target_resolver(resolver)
        .with_web_config(web_config)
        .build())
}

fn effective_request_user_agent(settings: &AiSettings) -> &str {
    let value = settings.request_user_agent.trim();
    if value.is_empty() {
        AI_REQUEST_USER_AGENT_DEFAULT
    } else {
        value
    }
}

fn ai_request_headers(settings: &AiSettings) -> AppResult<HeaderMap> {
    let user_agent = effective_request_user_agent(settings);
    let user_agent_value = HeaderValue::from_str(user_agent).map_err(|error| {
        AppError::Config(format!("Invalid AI User-Agent header value: {error}"))
    })?;
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, user_agent_value);
    Ok(headers)
}

fn adapter_kind(kind: &AiProviderKind) -> AdapterKind {
    match kind {
        AiProviderKind::Openai | AiProviderKind::OpenaiCompatible => AdapterKind::OpenAI,
        AiProviderKind::Anthropic => AdapterKind::Anthropic,
        AiProviderKind::Gemini => AdapterKind::Gemini,
        AiProviderKind::Deepseek => AdapterKind::DeepSeek,
        AiProviderKind::Groq => AdapterKind::Groq,
        AiProviderKind::Ollama => AdapterKind::Ollama,
        AiProviderKind::Xai
        | AiProviderKind::Cohere
        | AiProviderKind::Mimo
        | AiProviderKind::Zai => AdapterKind::OpenAI,
    }
}

pub async fn list_model_names(app: &tauri::AppHandle) -> AppResult<Vec<AiModelDiscovery>> {
    let settings = config::load_app_settings(app)?;

    let custom_credentials: Vec<_> = settings
        .ai
        .provider_credentials
        .iter()
        .filter(|c| c.enabled && c.provider_kind == AiProviderKind::OpenaiCompatible)
        .collect();

    let mut models = BTreeMap::new();
    let mut errors = Vec::new();

    for credential in &custom_credentials {
        let base_url = credential
            .base_url
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string();
        if base_url.is_empty() {
            continue;
        }
        let api_key = credential.api_key.clone().filter(|v| !v.trim().is_empty());
        let label = credential.name.as_str();
        tracing::info!(
            credential = label,
            url = base_url,
            "Fetching model list from custom provider"
        );
        match fetch_openai_compatible_models(&base_url, api_key.as_deref(), &settings.ai).await {
            Ok(names) => {
                tracing::info!(
                    credential = label,
                    count = names.len(),
                    models = ?names,
                    "Fetched models from custom provider"
                );
                for name in names {
                    let trimmed = name.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let id = ai_model_id_for_credential(&credential.id, trimmed);
                    models.entry(id.clone()).or_insert(AiModelDiscovery {
                        id,
                        name: trimmed.to_string(),
                        provider_kind: Some(AiProviderKind::OpenaiCompatible),
                        credential_id: Some(credential.id.clone()),
                        source: AiModelSource::RustGenai,
                    });
                }
            }
            Err(error) => {
                tracing::warn!(credential = label, %error, "Failed to fetch models from custom provider");
                errors.push(format!("{label}: {error}"));
            }
        }
    }

    if models.is_empty() && !errors.is_empty() {
        return Err(AppError::Config(format!(
            "Failed to list AI models: {}",
            errors.join("; ")
        )));
    }

    Ok(models.into_values().collect())
}

/// Fetches model names from an OpenAI-compatible `/v1/models` endpoint directly via HTTP,
/// bypassing `genai::Client::all_model_names` which does not apply the `ServiceTargetResolver`
/// (and therefore ignores custom auth/endpoint configuration).
async fn fetch_openai_compatible_models(
    base_url: &str,
    api_key: Option<&str>,
    settings: &AiSettings,
) -> AppResult<Vec<String>> {
    let url = openai_compatible_models_url(base_url)?;
    let client = reqwest::Client::builder()
        .default_headers(ai_request_headers(settings)?)
        .build()
        .map_err(|e| AppError::Config(format!("Failed to build AI HTTP client: {e}")))?;
    let mut req = client.get(&url);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let resp = req
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Config(format!("Failed to fetch models from {url}: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Config(format!(
            "Failed to fetch models from {url}: {status} {body}"
        )));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Config(format!("Invalid JSON from {url}: {e}")))?;
    let names: Vec<String> = body["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item["id"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(names)
}

fn openai_compatible_models_url(base_url: &str) -> AppResult<String> {
    join_api_base_url(base_url, "models")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_compatible_models_url_accepts_missing_trailing_slash() {
        assert_eq!(
            openai_compatible_models_url("https://api.example.com/v1").unwrap(),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn openai_compatible_models_url_accepts_trailing_slash() {
        assert_eq!(
            openai_compatible_models_url("https://api.example.com/v1/").unwrap(),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn openai_compatible_models_url_preserves_query() {
        assert_eq!(
            openai_compatible_models_url("https://api.example.com/v1?api-version=1").unwrap(),
            "https://api.example.com/v1/models?api-version=1"
        );
    }

    #[test]
    fn ai_request_headers_use_custom_user_agent() {
        let mut settings = AiSettings::default();
        settings.request_user_agent = "nyaterm-test/1.0".to_string();

        let headers = ai_request_headers(&settings).unwrap();

        assert_eq!(
            headers
                .get(USER_AGENT)
                .and_then(|value| value.to_str().ok()),
            Some("nyaterm-test/1.0")
        );
    }

    #[test]
    fn ai_request_headers_fall_back_for_blank_user_agent() {
        let mut settings = AiSettings::default();
        settings.request_user_agent = "   ".to_string();

        let headers = ai_request_headers(&settings).unwrap();

        assert_eq!(
            headers
                .get(USER_AGENT)
                .and_then(|value| value.to_str().ok()),
            Some(AI_REQUEST_USER_AGENT_DEFAULT)
        );
    }

    #[test]
    fn ai_request_headers_reject_invalid_user_agent() {
        let mut settings = AiSettings::default();
        settings.request_user_agent = "bad\r\nvalue".to_string();

        let error = ai_request_headers(&settings).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("Invalid AI User-Agent header value")
        );
    }
}
