fn parse_windterm(path: &str) -> AppResult<Vec<ImportedSession>> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| AppError::Config(format!("Cannot read file: {e}")))?;
    parse_windterm_content(&content)
}

fn parse_windterm_content(content: &str) -> AppResult<Vec<ImportedSession>> {
    let entries: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| AppError::Config(format!("Invalid WindTerm JSON: {e}")))?;

    let mut sessions = Vec::new();

    for entry in &entries {
        let protocol = entry
            .get("session.protocol")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !protocol.eq_ignore_ascii_case("SSH") {
            continue;
        }

        let target = entry
            .get("session.target")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let (host, username) = parse_windterm_target(target);
        if host.is_empty() {
            continue;
        }

        let name = entry
            .get("session.label")
            .and_then(|v| v.as_str())
            .unwrap_or(&host)
            .to_string();

        let port: u16 = entry
            .get("session.port")
            .and_then(|v| v.as_u64())
            .map_or(22, |p| p as u16);

        let group_path = entry
            .get("session.group")
            .and_then(|v| v.as_str())
            .and_then(|s| {
                let s = s.trim();
                if s.is_empty() {
                    None
                } else {
                    let segments: Vec<String> = s
                        .split('>')
                        .filter(|seg| !seg.is_empty())
                        .map(|seg| seg.trim().to_string())
                        .collect();
                    if segments.is_empty() {
                        None
                    } else {
                        Some(segments)
                    }
                }
            });

        sessions.push(ImportedSession {
            name,
            host,
            port,
            username,
            auth_type: "password".to_string(),
            group_path,
            description: None,
        });
    }

    Ok(sessions)
}

fn parse_windterm_target(target: &str) -> (String, String) {
    let target = target.trim();
    if let Some((username, host)) = target.rsplit_once('@') {
        if !username.is_empty() && !host.is_empty() {
            return (host.to_string(), username.to_string());
        }
    }
    (target.to_string(), "root".to_string())
}

// ── NyaTerm JSON (.json) ───────────────────────────────────────────────────
