use crate::config::AiSettings;
use std::collections::HashMap;
use std::sync::OnceLock;

use super::types::{AiAction, AiChatRequest, CommandObservation};

const SYSTEM_PROMPT_ZH: &str = r#"你是一个专业、谨慎、安全优先的 Linux / DevOps / 云原生终端助手。
你的任务是帮助用户解释终端输出、生成 Shell 命令、分析错误、提供排查步骤。

必须遵守：
1. 不要建议不可逆高危操作，除非明确说明风险和安全替代方案。
2. 默认生成只读诊断命令。
3. 对任何删除、格式化、重启、停服务、改权限、批量变更命令标记风险。
4. 命令必须适配用户当前系统、架构、shell 和权限上下文。
5. 输出必须结构化，包含命令、说明、风险等级、影响范围和回滚建议。
6. 不要编造当前系统不存在的信息；不确定时给出验证命令。
7. 不要要求用户粘贴密码、私钥、token。

只返回一个 JSON 对象，不要使用 Markdown 代码块。格式：
{
  "text": "给用户看的说明",
  "commandCards": [
    {
      "id": "cmd-uuid",
      "title": "标题",
      "command": "shell command",
      "explanation": "命令说明",
      "riskLevel": "low|medium|high|critical",
      "riskReason": "风险原因",
      "expectedEffect": "预计影响",
      "rollback": "回滚方式或无需回滚",
      "category": "Linux 性能"
    }
  ]
}"#;

const SYSTEM_PROMPT_EN: &str = r#"You are a professional, careful, safety-first Linux / DevOps / cloud-native terminal assistant.
Your job is to explain terminal output, generate Shell commands, analyze errors, and suggest next troubleshooting steps.

You must follow these rules:
1. Do not suggest irreversible high-risk actions unless you clearly explain the risk and provide safer alternatives.
2. Prefer read-only diagnostic commands by default.
3. Mark any delete, format, restart, stop-service, permission-change, or bulk-change command with the appropriate risk.
4. Commands must fit the user's current system, architecture, shell, and privilege context.
5. Output must be structured and include commands, explanations, risk level, expected effect, and rollback guidance.
6. Do not invent facts about the current system. If uncertain, provide verification commands.
7. Do not ask the user to paste passwords, private keys, or tokens.

Return exactly one JSON object and do not use Markdown code fences. Format:
{
  "text": "user-facing explanation",
  "commandCards": [
    {
      "id": "cmd-uuid",
      "title": "title",
      "command": "shell command",
      "explanation": "command explanation",
      "riskLevel": "low|medium|high|critical",
      "riskReason": "why this risk applies",
      "expectedEffect": "expected effect",
      "rollback": "rollback steps or state that rollback is unnecessary",
      "category": "Linux performance"
    }
  ]
}"#;

const SYSTEM_PROMPT_KO: &str = r#"당신은 전문적이고 신중하며 안전을 최우선으로 하는 Linux / DevOps / 클라우드 네이티브 터미널 어시스턴트입니다.
사용자의 터미널 출력 설명, Shell 명령 생성, 오류 분석, 다음 문제 해결 단계 제안을 돕는 것이 임무입니다.

반드시 다음 규칙을 따르세요:
1. 되돌릴 수 없는 고위험 작업은 위험을 명확히 설명하고 더 안전한 대안을 제공하지 않는 한 제안하지 마세요.
2. 기본적으로 읽기 전용 진단 명령을 우선하세요.
3. 삭제, 포맷, 재시작, 서비스 중지, 권한 변경, 대량 변경 명령에는 적절한 위험 등급을 표시하세요.
4. 명령은 사용자의 현재 시스템, 아키텍처, shell, 권한 컨텍스트에 맞아야 합니다.
5. 출력은 구조화되어야 하며 명령, 설명, 위험 등급, 예상 효과, 롤백 안내를 포함해야 합니다.
6. 현재 시스템에 대해 존재하지 않는 정보를 지어내지 마세요. 확실하지 않으면 확인 명령을 제공하세요.
7. 사용자에게 비밀번호, 개인 키, token을 붙여 넣으라고 요청하지 마세요.

Markdown 코드 블록을 사용하지 말고 정확히 하나의 JSON 객체만 반환하세요. 형식:
{
  "text": "사용자에게 보여줄 설명",
  "commandCards": [
    {
      "id": "cmd-uuid",
      "title": "제목",
      "command": "shell command",
      "explanation": "명령 설명",
      "riskLevel": "low|medium|high|critical",
      "riskReason": "위험 이유",
      "expectedEffect": "예상 효과",
      "rollback": "롤백 단계 또는 롤백이 필요 없다는 설명",
      "category": "Linux 성능"
    }
  ]
}"#;

const AGENT_SYSTEM_PROMPT_ZH: &str = r#"你是一个终端自动化 Agent，通过"思考—执行—观察"循环完成用户的任务。

每一轮你只能做一件事：调用 execute_command 工具执行一条命令，或调用 final_answer 工具给出最终回答。

规则：
1. 每轮必须且只能调用一个工具，不要在普通正文里输出 JSON。
2. 如果需要执行命令，调用 execute_command。
3. 任务完成或无需执行命令时，调用 final_answer。
4. thought 和 answer 尽量使用用户请求指定的目标语言。
5. 优先使用只读命令收集信息，再做修改操作。
6. 不要执行不可逆高危命令（如 rm -rf /、mkfs、停止 SSH 等），改为在 thought 中说明风险并调用 final_answer。
7. 不要编造信息；不确定时先用验证命令确认。
8. 不要要求用户提供密码、私钥、token。
9. 命令必须适配用户当前的系统和 shell 环境。
10. riskLevel 规则：只读命令 → low，普通写操作 → medium，删除/重启/权限修改 → high，不可逆破坏 → critical。
11. 调用 execute_command 时必须同时提供 riskLevel 和 riskReason；riskReason 要简短说明为什么这样分级。"#;

const AGENT_SYSTEM_PROMPT_EN: &str = r#"You are a terminal automation agent that completes tasks using a think-execute-observe loop.

In each turn, do exactly one thing: call the execute_command tool to execute one command, or call the final_answer tool to finish.

Rules:
1. You must call exactly one tool per turn. Do not put protocol JSON in normal assistant text.
2. If a command must be executed, call execute_command.
3. If the task is complete or no command is needed, call final_answer.
4. Use the target language requested by the user for both thought and answer whenever possible.
5. Prefer read-only commands to gather information before making changes.
6. Do not execute irreversible high-risk commands (for example rm -rf /, mkfs, or stopping SSH). Explain the risk in thought and call final_answer instead.
7. Do not invent facts. If uncertain, verify first.
8. Do not ask the user for passwords, private keys, or tokens.
9. Commands must fit the user's current system and shell environment.
10. riskLevel guidance: read-only commands -> low, normal write actions -> medium, delete/restart/permission changes -> high, irreversible destructive actions -> critical.
11. execute_command calls must include both riskLevel and riskReason. Keep riskReason brief and explain why the risk applies."#;

const AGENT_SYSTEM_PROMPT_KO: &str = r#"당신은 생각-실행-관찰 루프를 사용해 작업을 완료하는 터미널 자동화 Agent입니다.

각 턴에서는 정확히 한 가지만 해야 합니다: execute_command 도구를 호출해 명령 하나를 실행하거나, final_answer 도구를 호출해 마무리하세요.

규칙:
1. 각 턴에서 반드시 정확히 하나의 도구만 호출하세요. 일반 assistant 본문에 프로토콜 JSON을 넣지 마세요.
2. 명령을 실행해야 한다면 execute_command를 호출하세요.
3. 작업이 완료되었거나 명령이 필요 없다면 final_answer를 호출하세요.
4. 가능하면 thought와 answer 모두 사용자 요청의 대상 언어를 사용하세요.
5. 변경 작업 전에 읽기 전용 명령으로 정보를 수집하는 것을 우선하세요.
6. 되돌릴 수 없는 고위험 명령(예: rm -rf /, mkfs, SSH 중지)은 실행하지 마세요. thought에서 위험을 설명하고 대신 final_answer를 호출하세요.
7. 정보를 지어내지 마세요. 확실하지 않으면 먼저 확인하세요.
8. 사용자에게 비밀번호, 개인 키, token을 요청하지 마세요.
9. 명령은 사용자의 현재 시스템과 shell 환경에 맞아야 합니다.
10. riskLevel 기준: 읽기 전용 명령 -> low, 일반 쓰기 작업 -> medium, 삭제/재시작/권한 변경 -> high, 되돌릴 수 없는 파괴적 작업 -> critical.
11. execute_command 호출에는 반드시 riskLevel과 riskReason을 모두 포함하세요. riskReason은 짧게 작성하고 해당 위험 등급의 이유를 설명하세요."#;

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
enum PromptLanguage {
    ZhCn,
    En,
    Ko,
}

fn normalize_prompt_locale(language: &str) -> String {
    let normalized = language.trim().replace('_', "-").to_ascii_lowercase();
    match normalized.as_str() {
        "zh" | "zh-cn" | "zh-hans" | "zh-hans-cn" => "zh-cn".to_string(),
        "en" | "en-us" | "en-gb" => "en".to_string(),
        "ko" | "ko-kr" => "ko".to_string(),
        _ => normalized,
    }
}

fn prompt_language_map() -> &'static HashMap<&'static str, PromptLanguage> {
    static PROMPT_LANGUAGE_MAP: OnceLock<HashMap<&'static str, PromptLanguage>> = OnceLock::new();
    PROMPT_LANGUAGE_MAP.get_or_init(|| {
        HashMap::from([
            ("zh-cn", PromptLanguage::ZhCn),
            ("en", PromptLanguage::En),
            ("ko", PromptLanguage::Ko),
        ])
    })
}

fn resolve_prompt_language(language: &str) -> PromptLanguage {
    let normalized = normalize_prompt_locale(language);
    prompt_language_map()
        .get(normalized.as_str())
        .copied()
        .unwrap_or(PromptLanguage::En)
}

pub(super) fn system_prompt(language: &str) -> &'static str {
    match resolve_prompt_language(language) {
        PromptLanguage::ZhCn => SYSTEM_PROMPT_ZH,
        PromptLanguage::En => SYSTEM_PROMPT_EN,
        PromptLanguage::Ko => SYSTEM_PROMPT_KO,
    }
}

pub(super) fn agent_system_prompt(language: &str) -> &'static str {
    match resolve_prompt_language(language) {
        PromptLanguage::ZhCn => AGENT_SYSTEM_PROMPT_ZH,
        PromptLanguage::En => AGENT_SYSTEM_PROMPT_EN,
        PromptLanguage::Ko => AGENT_SYSTEM_PROMPT_KO,
    }
}

pub(super) fn build_agent_prompt(request: &AiChatRequest, settings: &AiSettings) -> String {
    let ctx = &request.context;
    match resolve_prompt_language(&request.options.language) {
        PromptLanguage::ZhCn => format!(
            r#"用户任务：
{user_input}

当前连接上下文：
- 连接名：{connection_name}
- 主机：{host}
- 用户：{username}
- 当前目录：{cwd}
- 操作系统：{os}
- 架构：{arch}

最近终端输出（最多 {line_limit} 行）：
{recent_output}

要求：
- 面向用户的说明、总结以及推理过程使用：{language}
- 命令、路径、文件名、配置键名保持原样，不要翻译

请开始执行任务。每轮调用且只调用一个工具。"#,
            user_input = request.user_input,
            connection_name = ctx.connection_name.as_deref().unwrap_or("-"),
            host = ctx.host.as_deref().unwrap_or("-"),
            username = ctx.username.as_deref().unwrap_or("-"),
            cwd = ctx.cwd.as_deref().unwrap_or("-"),
            os = ctx.os.as_deref().unwrap_or("-"),
            arch = ctx.arch.as_deref().unwrap_or(std::env::consts::ARCH),
            line_limit = settings.context_line_limit,
            recent_output = ctx.recent_output,
            language = request.options.language,
        ),
        PromptLanguage::Ko => format!(
            r#"사용자 작업:
{user_input}

현재 연결 컨텍스트:
- 연결 이름: {connection_name}
- 호스트: {host}
- 사용자: {username}
- 현재 디렉터리: {cwd}
- 운영 체제: {os}
- 아키텍처: {arch}

최근 터미널 출력(최대 {line_limit}줄):
{recent_output}

요구 사항:
- 사용자에게 보이는 설명, 요약, 추론에는 {language}을(를) 사용하세요.
- 명령, 경로, 파일 이름, 구성 키는 변경하지 말고 번역하지 마세요.

지금 작업을 시작하세요. 각 턴에서 정확히 하나의 도구만 호출하세요."#,
            user_input = request.user_input,
            connection_name = ctx.connection_name.as_deref().unwrap_or("-"),
            host = ctx.host.as_deref().unwrap_or("-"),
            username = ctx.username.as_deref().unwrap_or("-"),
            cwd = ctx.cwd.as_deref().unwrap_or("-"),
            os = ctx.os.as_deref().unwrap_or("-"),
            arch = ctx.arch.as_deref().unwrap_or(std::env::consts::ARCH),
            line_limit = settings.context_line_limit,
            recent_output = ctx.recent_output,
            language = request.options.language,
        ),
        PromptLanguage::En => format!(
            r#"User task:
{user_input}

Current connection context:
- Connection name: {connection_name}
- Host: {host}
- User: {username}
- Current directory: {cwd}
- Operating system: {os}
- Architecture: {arch}

Recent terminal output (up to {line_limit} lines):
{recent_output}

Requirements:
- Use {language} for user-facing explanations and summaries.
- Prefer {language} for reasoning when possible.
- Keep commands, paths, file names, and configuration keys unchanged.

Start the task now. Call exactly one tool per turn."#,
            user_input = request.user_input,
            connection_name = ctx.connection_name.as_deref().unwrap_or("-"),
            host = ctx.host.as_deref().unwrap_or("-"),
            username = ctx.username.as_deref().unwrap_or("-"),
            cwd = ctx.cwd.as_deref().unwrap_or("-"),
            os = ctx.os.as_deref().unwrap_or("-"),
            arch = ctx.arch.as_deref().unwrap_or(std::env::consts::ARCH),
            line_limit = settings.context_line_limit,
            recent_output = ctx.recent_output,
            language = request.options.language,
        ),
    }
}

pub(super) fn build_observation_message(
    obs: &CommandObservation,
    command: &str,
    language: &str,
) -> String {
    let status = obs
        .exit_code
        .map(|c| format!("exit code {c}"))
        .unwrap_or_else(|| "unknown exit code".to_string());
    let output = if obs.output.len() > 8000 {
        let truncated = &obs.output[obs.output.len() - 8000..];
        format!("...(truncated)\n{truncated}")
    } else {
        obs.output.clone()
    };
    match resolve_prompt_language(language) {
        PromptLanguage::ZhCn => format!(
            "命令 `{command}` 执行完成（{status}，耗时 {duration}ms）。\n\n输出：\n{output}\n\n请根据观察结果决定下一步。每轮必须且只能调用一个工具：execute_command 或 final_answer。不要在普通正文里输出 JSON。",
            duration = obs.duration_ms,
        ),
        PromptLanguage::Ko => format!(
            "명령 `{command}` 실행이 완료되었습니다({status}, {duration}ms).\n\n출력:\n{output}\n\n이 관찰 결과를 바탕으로 다음 단계를 결정하세요. execute_command 또는 final_answer 중 정확히 하나의 도구만 호출하세요. 일반 assistant 본문에 프로토콜 JSON을 넣지 마세요.",
            duration = obs.duration_ms,
        ),
        PromptLanguage::En => format!(
            "Command `{command}` finished ({status}, {duration}ms).\n\nOutput:\n{output}\n\nDecide the next step based on this observation. Call exactly one tool: execute_command or final_answer. Do not put protocol JSON in normal assistant text.",
            duration = obs.duration_ms,
        ),
    }
}

pub(super) fn agent_send_only_observation(language: &str) -> &'static str {
    match resolve_prompt_language(language) {
        PromptLanguage::ZhCn => "命令已发送到终端，但当前会话使用仅发送模式，未捕获输出。",
        PromptLanguage::Ko => {
            "명령을 터미널로 보냈지만 현재 세션은 전송 전용 모드이므로 출력을 캡처하지 않았습니다."
        }
        PromptLanguage::En => {
            "Command was sent to the terminal, but this session uses send-only mode, so output was not captured."
        }
    }
}

pub(super) fn agent_execution_disabled_message(language: &str) -> &'static str {
    match resolve_prompt_language(language) {
        PromptLanguage::ZhCn => "当前会话已禁用 AI Agent 命令执行。",
        PromptLanguage::Ko => "현재 세션에서 AI Agent 명령 실행이 비활성화되어 있습니다.",
        PromptLanguage::En => "AI Agent command execution is disabled for the current session.",
    }
}

pub(super) fn build_agent_rejected_message(command: &str, language: &str) -> String {
    match resolve_prompt_language(language) {
        PromptLanguage::ZhCn => {
            format!("用户拒绝执行命令 `{command}`。请换用其他方案或给出 final_answer。")
        }
        PromptLanguage::Ko => {
            format!(
                "사용자가 명령 `{command}` 실행을 거부했습니다. 다른 방법을 사용하거나 final_answer를 제공하세요."
            )
        }
        PromptLanguage::En => {
            format!(
                "The user rejected command `{command}`. Use another approach or provide final_answer."
            )
        }
    }
}

pub(super) fn build_agent_failed_message(error: &str, language: &str) -> String {
    match resolve_prompt_language(language) {
        PromptLanguage::ZhCn => format!("命令执行失败：{error}。请分析原因并给出下一步。"),
        PromptLanguage::Ko => {
            format!("명령 실행이 실패했습니다: {error}. 원인을 분석하고 다음 단계를 제시하세요.")
        }
        PromptLanguage::En => {
            format!(
                "Command execution failed: {error}. Analyze the cause and provide the next step."
            )
        }
    }
}

pub(super) fn build_agent_unknown_action_message(
    action: &str,
    fallback: &str,
    language: &str,
) -> String {
    match resolve_prompt_language(language) {
        PromptLanguage::ZhCn => {
            format!("未知动作 `{action}`。将其作为最终回答处理。{fallback}")
        }
        PromptLanguage::Ko => {
            format!("알 수 없는 작업 `{action}`입니다. 최종 답변으로 처리합니다. {fallback}")
        }
        PromptLanguage::En => {
            format!("Unknown action `{action}`. Treating as final answer. {fallback}")
        }
    }
}

pub(super) fn agent_max_steps_message(language: &str) -> &'static str {
    match resolve_prompt_language(language) {
        PromptLanguage::ZhCn => "Agent 已达到最大步数限制，任务可能未完成。",
        PromptLanguage::Ko => {
            "Agent가 최대 단계 수 제한에 도달했으며 작업이 완료되지 않았을 수 있습니다."
        }
        PromptLanguage::En => {
            "Agent reached the maximum step limit, so the task may be incomplete."
        }
    }
}

pub(super) fn build_prompt(request: &AiChatRequest, settings: &AiSettings) -> String {
    let ctx = &request.context;
    match resolve_prompt_language(&request.options.language) {
        PromptLanguage::ZhCn => {
            let action = match request.action {
                AiAction::GenerateCommand => "根据自然语言需求生成 1 到 2 条 Shell 命令",
                AiAction::ExplainOutput => "解释最近终端输出并给出下一步建议",
                AiAction::ExplainSelected => "解释用户选中的终端文本并给出下一步建议",
                AiAction::AnalyzeError => "分析终端错误输出并给出排查步骤",
                AiAction::RepairFromSelection => "根据选中内容生成修复或排查命令",
                AiAction::CustomTerminalAction => "根据用户配置的终端 AI 功能处理选中内容",
                AiAction::CustomFileAction => "根据用户配置的文件 AI 功能处理文件内容",
            };
            format!(
                r#"任务：{action}
用户需求：
{user_input}

当前连接上下文：
- 连接名：{connection_name}
- 主机：{host}
- 端口：{port}
- 用户：{username}
- 当前目录：{cwd}
- 操作系统：{os}
- 架构：{arch}
- 当前输入：{input_buffer}

选中文本：
{selected_text}

最近终端输出（最多 {line_limit} 行）：
{recent_output}

要求：
- 语言：{language}
- 面向用户的说明和推理过程使用该语言；命令、路径、文件名、配置键名保持原样
- 安全模式：{safety_mode}
- 最多生成 {max_commands} 条命令
- 优先生成只读诊断命令
- 如果信息不足，请给出验证命令
- 必须返回 JSON 对象，不要返回 Markdown"#,
                user_input = request.user_input,
                connection_name = ctx.connection_name.as_deref().unwrap_or("-"),
                host = ctx.host.as_deref().unwrap_or("-"),
                port = ctx
                    .port
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                username = ctx.username.as_deref().unwrap_or("-"),
                cwd = ctx.cwd.as_deref().unwrap_or("-"),
                os = ctx.os.as_deref().unwrap_or("-"),
                arch = ctx.arch.as_deref().unwrap_or(std::env::consts::ARCH),
                input_buffer = ctx.input_buffer,
                selected_text = ctx.selected_text,
                line_limit = settings.context_line_limit,
                recent_output = ctx.recent_output,
                language = request.options.language,
                safety_mode = request.options.safety_mode,
                max_commands = request.options.max_output_commands,
            )
        }
        PromptLanguage::Ko => {
            let action = match request.action {
                AiAction::GenerateCommand => "자연어 요청에서 Shell 명령 1~2개 생성",
                AiAction::ExplainOutput => "최근 터미널 출력을 설명하고 다음 단계 제안",
                AiAction::ExplainSelected => "선택한 터미널 텍스트를 설명하고 다음 단계 제안",
                AiAction::AnalyzeError => "터미널 오류 출력을 분석하고 문제 해결 단계 제공",
                AiAction::RepairFromSelection => "선택한 내용에서 복구 또는 문제 해결 명령 생성",
                AiAction::CustomTerminalAction => {
                    "사용자가 구성한 터미널 AI 작업으로 선택한 내용 처리"
                }
                AiAction::CustomFileAction => "사용자가 구성한 파일 AI 작업으로 파일 내용 처리",
            };
            format!(
                r#"작업: {action}
사용자 요청:
{user_input}

현재 연결 컨텍스트:
- 연결 이름: {connection_name}
- 호스트: {host}
- 포트: {port}
- 사용자: {username}
- 현재 디렉터리: {cwd}
- 운영 체제: {os}
- 아키텍처: {arch}
- 현재 입력: {input_buffer}

선택한 텍스트:
{selected_text}

최근 터미널 출력(최대 {line_limit}줄):
{recent_output}

요구 사항:
- 대상 언어: {language}
- 사용자에게 보이는 설명과 추론에는 가능하면 해당 언어를 사용하세요.
- 명령, 경로, 파일 이름, 구성 키는 변경하지 말고 번역하지 마세요.
- 안전 모드: {safety_mode}
- 최대 {max_commands}개의 명령을 생성하세요.
- 읽기 전용 진단 명령을 먼저 우선하세요.
- 정보가 부족하면 확인 명령을 제공하세요.
- JSON 객체만 반환하세요. Markdown을 반환하지 마세요."#,
                user_input = request.user_input,
                connection_name = ctx.connection_name.as_deref().unwrap_or("-"),
                host = ctx.host.as_deref().unwrap_or("-"),
                port = ctx
                    .port
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                username = ctx.username.as_deref().unwrap_or("-"),
                cwd = ctx.cwd.as_deref().unwrap_or("-"),
                os = ctx.os.as_deref().unwrap_or("-"),
                arch = ctx.arch.as_deref().unwrap_or(std::env::consts::ARCH),
                input_buffer = ctx.input_buffer,
                selected_text = ctx.selected_text,
                line_limit = settings.context_line_limit,
                recent_output = ctx.recent_output,
                language = request.options.language,
                safety_mode = request.options.safety_mode,
                max_commands = request.options.max_output_commands,
            )
        }
        PromptLanguage::En => {
            let action = match request.action {
                AiAction::GenerateCommand => {
                    "Generate 1 to 2 Shell commands from the natural language request"
                }
                AiAction::ExplainOutput => {
                    "Explain the recent terminal output and suggest the next step"
                }
                AiAction::ExplainSelected => {
                    "Explain the selected terminal text and suggest the next step"
                }
                AiAction::AnalyzeError => {
                    "Analyze the terminal error output and provide troubleshooting steps"
                }
                AiAction::RepairFromSelection => {
                    "Generate repair or troubleshooting commands from the selected content"
                }
                AiAction::CustomTerminalAction => {
                    "Handle the selected content using the configured terminal AI action"
                }
                AiAction::CustomFileAction => {
                    "Handle the file content using the configured file AI action"
                }
            };
            format!(
                r#"Task: {action}
User request:
{user_input}

Current connection context:
- Connection name: {connection_name}
- Host: {host}
- Port: {port}
- User: {username}
- Current directory: {cwd}
- Operating system: {os}
- Architecture: {arch}
- Current input: {input_buffer}

Selected text:
{selected_text}

Recent terminal output (up to {line_limit} lines):
{recent_output}

Requirements:
- Target language: {language}
- Use that language for user-facing explanation and reasoning when possible.
- Keep commands, paths, file names, and configuration keys unchanged.
- Safety mode: {safety_mode}
- Generate at most {max_commands} commands.
- Prefer read-only diagnostic commands first.
- If information is insufficient, provide verification commands.
- Return a JSON object only. Do not return Markdown."#,
                user_input = request.user_input,
                connection_name = ctx.connection_name.as_deref().unwrap_or("-"),
                host = ctx.host.as_deref().unwrap_or("-"),
                port = ctx
                    .port
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                username = ctx.username.as_deref().unwrap_or("-"),
                cwd = ctx.cwd.as_deref().unwrap_or("-"),
                os = ctx.os.as_deref().unwrap_or("-"),
                arch = ctx.arch.as_deref().unwrap_or(std::env::consts::ARCH),
                input_buffer = ctx.input_buffer,
                selected_text = ctx.selected_text,
                line_limit = settings.context_line_limit,
                recent_output = ctx.recent_output,
                language = request.options.language,
                safety_mode = request.options.safety_mode,
                max_commands = request.options.max_output_commands,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AiMode;

    use super::super::types::{AiContext, AiRequestOptions};

    fn test_request(language: &str) -> AiChatRequest {
        AiChatRequest {
            stream_id: None,
            session_id: None,
            connection_id: None,
            terminal_session_id: None,
            mode: AiMode::Ask,
            model_id: None,
            model_name: None,
            action: AiAction::GenerateCommand,
            user_input: "check disk usage".to_string(),
            context: AiContext {
                connection_name: Some("prod".to_string()),
                host: Some("example.com".to_string()),
                username: Some("ops".to_string()),
                cwd: Some("/srv/app".to_string()),
                os: Some("Linux".to_string()),
                recent_output: "Filesystem Size Used Avail Use% Mounted on".to_string(),
                ..AiContext::default()
            },
            options: AiRequestOptions {
                language: language.to_string(),
                ..AiRequestOptions::default()
            },
        }
    }

    #[test]
    fn resolves_korean_locale_variants() {
        assert!(resolve_prompt_language("ko") == PromptLanguage::Ko);
        assert!(resolve_prompt_language("ko-KR") == PromptLanguage::Ko);
        assert!(resolve_prompt_language("ko_KR") == PromptLanguage::Ko);
    }

    #[test]
    fn returns_korean_system_prompts() {
        assert!(system_prompt("ko").contains("터미널 어시스턴트"));
        assert!(agent_system_prompt("ko").contains("터미널 자동화 Agent"));
    }

    #[test]
    fn builds_korean_chat_and_agent_prompts() {
        let settings = AiSettings::default();
        let request = test_request("ko");

        let prompt = build_prompt(&request, &settings);
        assert!(prompt.contains("작업: 자연어 요청에서 Shell 명령"));
        assert!(prompt.contains("현재 연결 컨텍스트:"));
        assert!(prompt.contains("대상 언어: ko"));

        let agent_prompt = build_agent_prompt(&request, &settings);
        assert!(agent_prompt.contains("사용자 작업:"));
        assert!(agent_prompt.contains("최근 터미널 출력"));
        assert!(agent_prompt.contains("ko"));
    }

    #[test]
    fn builds_korean_observation_message() {
        let obs = CommandObservation {
            output: "ok".to_string(),
            exit_code: Some(0),
            duration_ms: 42,
        };

        let message = build_observation_message(&obs, "ls", "ko-KR");
        assert!(message.contains("명령 `ls` 실행이 완료되었습니다"));
        assert!(message.contains("출력:"));
        assert!(message.contains("execute_command 또는 final_answer"));
    }

    #[test]
    fn builds_korean_agent_runtime_messages() {
        assert!(agent_send_only_observation("ko").contains("전송 전용 모드"));
        assert!(agent_execution_disabled_message("ko-KR").contains("비활성화"));
        assert!(build_agent_rejected_message("rm -rf tmp", "ko").contains("거부했습니다"));
        assert!(build_agent_failed_message("boom", "ko").contains("다음 단계"));
        assert!(build_agent_unknown_action_message("noop", "fallback", "ko").contains("fallback"));
        assert!(agent_max_steps_message("ko").contains("최대 단계 수"));
    }
}
