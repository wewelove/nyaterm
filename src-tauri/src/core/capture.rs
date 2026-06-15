//! Marker-based output capture for AI Agent PTY command execution.
//!
//! Instead of opening a separate exec channel (which is unaware of nested
//! shells, containers, or SSH hops), we inject the command directly into the
//! interactive PTY wrapped with unique boundary markers, then intercept the
//! markers in the output stream to extract the command's output and exit code.
//!
//! Key design decisions:
//!
//! 1. The shell **echoes** everything written to the PTY. The command text
//!    itself appears in the output stream before the command runs. We handle
//!    this with a `WaitingForStart` phase that suppresses all output until
//!    the real START marker appears in the *execution* output.
//!
//! 2. The wrapper breaks or escapes marker patterns so the echo text never
//!    contains a matchable `__DF_CMD_START_` or `__DF_CMD_END_` sequence.
//!    Only the execution output does.
//!
//! 3. Variable names avoid `__` to prevent the end-marker parser from
//!    finding false `__` suffixes inside echoed variable references.
//!
//! 4. After the END marker, a `PostCapture` phase suppresses the shell
//!    prompt that would otherwise appear as a blank line (since the
//!    command itself was invisible).

use base64::{Engine as _, engine::general_purpose};
use std::collections::HashMap;
use std::time::Instant;
use tokio::sync::oneshot;

use crate::config::AiExecutionProfile;

/// Result returned to the caller when capture completes.
pub struct CapturedOutput {
    pub output: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
}

const MARKER_PREFIX: &str = "__DF_CMD_";

/// Build the shell snippet that wraps a user command with start/end markers.
///
/// The emitted text on the PTY will look like:
/// ```text
/// __DF_CMD_START_{marker_id}__
/// <command output>
/// __DF_CMD_END_{marker_id}_{exit_code}__
/// ```
///
/// Each profile keeps marker text split or escaped so that the **echoed**
/// command line never contains a matchable `__DF_CMD_START_` or
/// `__DF_CMD_END_` pattern. Only the command's execution output contains the
/// full markers.
pub fn build_capture_command(
    profile: AiExecutionProfile,
    marker_id: &str,
    command: &str,
) -> Option<String> {
    match profile {
        AiExecutionProfile::Posix => Some(build_posix_capture_command(marker_id, command)),
        AiExecutionProfile::Powershell => {
            Some(build_powershell_capture_command(marker_id, command))
        }
        AiExecutionProfile::Cmd => Some(build_cmd_capture_command(marker_id, command)),
        AiExecutionProfile::Auto | AiExecutionProfile::SendOnly | AiExecutionProfile::Disabled => {
            None
        }
    }
}

fn build_posix_capture_command(marker_id: &str, command: &str) -> String {
    format!(
        " printf '\\n{MARKER_PREFIX}''START_{marker_id}__\\n'; {{ {command}; }}; _dfec=$?; printf '\\n{MARKER_PREFIX}''END_{marker_id}_'\"$_dfec\"'__\\n'; unset _dfec\n",
    )
}

fn build_powershell_capture_command(marker_id: &str, command: &str) -> String {
    let encoded_command = general_purpose::STANDARD.encode(command.as_bytes());
    format!(
        concat!(
            "$nyaiEc = 0; ",
            "$nyaiSuccess = $true; ",
            "$nyaiLastExit = 0; ",
            "$global:LASTEXITCODE = 0; ",
            "Write-Output (\"`n{MARKER_PREFIX}\" + \"START_{marker_id}__\"); ",
            "try {{ ",
            "$nyaiScript = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(\"{encoded_command}\")); ",
            "$nyaiScript = $nyaiScript + \"`r`n`$nyaiSuccess = `$?; `$nyaiLastExit = `$LASTEXITCODE\"; ",
            ". ([scriptblock]::Create($nyaiScript)); ",
            "if (($nyaiLastExit -is [int]) -and $nyaiLastExit -ne 0) {{ $nyaiEc = $nyaiLastExit }} ",
            "elseif ($nyaiSuccess) {{ $nyaiEc = 0 }} else {{ $nyaiEc = 1 ",
            "}} ",
            "}} catch {{ Write-Error $_; $nyaiEc = 1 }}; ",
            "Write-Output (\"`n{MARKER_PREFIX}\" + \"END_{marker_id}_\" + $nyaiEc + \"__\"); ",
            "Remove-Variable nyaiEc,nyaiSuccess,nyaiLastExit,nyaiScript -ErrorAction SilentlyContinue\r\n",
        ),
        MARKER_PREFIX = MARKER_PREFIX,
        marker_id = marker_id,
        encoded_command = encoded_command,
    )
}

fn build_cmd_capture_command(marker_id: &str, command: &str) -> String {
    let command = command
        .replace("\r\n", " & ")
        .replace('\n', " & ")
        .replace('\r', " & ");
    let command = command.trim();
    let command_segment = if command.is_empty() {
        String::new()
    } else {
        format!(" & {command}")
    };

    format!(
        concat!(
            "echo {MARKER_PREFIX}^START_{marker_id}__",
            "{command_segment}",
            " & call echo {MARKER_PREFIX}^END_{marker_id}_^%ERRORLEVEL^%__\r\n",
        ),
        MARKER_PREFIX = MARKER_PREFIX,
        marker_id = marker_id,
        command_segment = command_segment,
    )
}

#[derive(PartialEq)]
enum CapturePhase {
    /// Just registered — suppress all output (the echoed command text)
    /// until the real START marker appears in execution output.
    WaitingForStart,
    /// Between START and END markers — buffer output for the AI.
    Capturing,
    /// After the END marker — suppress the shell prompt that follows,
    /// then remove the capture.
    PostCapture,
}

/// Tracks one in-flight capture request.
struct ActiveCapture {
    buffer: String,
    phase: CapturePhase,
    start_time: Instant,
    result_tx: Option<oneshot::Sender<CapturedOutput>>,
}

/// Shared processor that all IO loops (SSH, PTY, Telnet, Serial) can use to
/// intercept marker sequences in the output stream.
pub struct OutputCaptureProcessor {
    active: HashMap<String, ActiveCapture>,
    pending_marker_tail: String,
}

impl OutputCaptureProcessor {
    pub fn new() -> Self {
        Self {
            active: HashMap::new(),
            pending_marker_tail: String::new(),
        }
    }

    /// Register a new capture. The caller should then write the
    /// `build_capture_command()` output into the PTY.
    ///
    /// From this point, all output is suppressed until the START marker
    /// appears (hiding the echoed command text).
    pub fn register(&mut self, marker_id: String, result_tx: oneshot::Sender<CapturedOutput>) {
        self.active.insert(
            marker_id,
            ActiveCapture {
                buffer: String::new(),
                phase: CapturePhase::WaitingForStart,
                start_time: Instant::now(),
                result_tx: Some(result_tx),
            },
        );
    }

    /// Returns true when at least one capture is in progress.
    pub fn has_active(&self) -> bool {
        !self.active.is_empty()
    }

    /// Cancel a capture by marker id (e.g. on timeout from the caller side).
    #[allow(dead_code)]
    pub fn cancel(&mut self, marker_id: &str) {
        self.active.remove(marker_id);
        if self.active.is_empty() {
            self.pending_marker_tail.clear();
        }
    }

    /// Process a chunk of visible terminal output. Returns the portion of
    /// text that should be forwarded to the terminal (i.e. everything
    /// **not** consumed by an active capture).
    ///
    /// - **WaitingForStart**: all text is suppressed (command echo).
    /// - **Capturing**: text is buffered for the AI result.
    /// - **PostCapture**: text is suppressed (shell prompt after command).
    /// - When the END marker is found, captured output is sent through
    ///   the `oneshot` channel automatically.
    pub fn process(&mut self, text: &str) -> String {
        if self.active.is_empty() {
            return text.to_string();
        }

        let combined;
        let mut remaining = if self.pending_marker_tail.is_empty() {
            text
        } else {
            combined = format!("{}{}", self.pending_marker_tail, text);
            self.pending_marker_tail.clear();
            combined.as_str()
        };
        let mut passthrough = String::with_capacity(text.len());

        while !remaining.is_empty() {
            if let Some(result) = self.try_match_start(remaining) {
                remaining = result.after;
                continue;
            }

            if let Some(result) = self.try_match_end(remaining) {
                passthrough.push_str(result.before);
                remaining = result.after;
                continue;
            }

            if let Some(capture_id) = self.any_in_phase(CapturePhase::Capturing) {
                if let Some(pos) = remaining.find(MARKER_PREFIX) {
                    if let Some(cap) = self.active.get_mut(&capture_id) {
                        cap.buffer.push_str(&remaining[..pos]);
                    }
                    let candidate = &remaining[pos..];
                    if self.is_possible_marker_prefix(candidate) {
                        self.pending_marker_tail.push_str(candidate);
                        remaining = "";
                    } else if pos == 0 {
                        if let Some(cap) = self.active.get_mut(&capture_id) {
                            cap.buffer.push_str(MARKER_PREFIX);
                        }
                        remaining = &remaining[MARKER_PREFIX.len()..];
                    } else {
                        remaining = &remaining[pos..];
                    }
                } else {
                    if let Some(cap) = self.active.get_mut(&capture_id) {
                        cap.buffer.push_str(remaining);
                    }
                    remaining = "";
                }
            } else if let Some(capture_id) = self.any_in_phase(CapturePhase::PostCapture) {
                // Suppress the shell prompt that appears after the command.
                // Remove the capture so the next chunk passes through normally.
                self.active.remove(&capture_id);
                if self.active.is_empty() {
                    self.pending_marker_tail.clear();
                }
                remaining = "";
            } else if self.any_in_phase(CapturePhase::WaitingForStart).is_some() {
                // Suppress everything — this is the echoed command text.
                // try_match_start above handles START marker detection.
                if let Some(tail_start) = self.possible_marker_tail_start(remaining) {
                    self.pending_marker_tail.push_str(&remaining[tail_start..]);
                }
                remaining = "";
            } else if let Some(pos) = remaining.find(MARKER_PREFIX) {
                passthrough.push_str(&remaining[..pos]);
                if pos == 0 {
                    passthrough.push_str(MARKER_PREFIX);
                    remaining = &remaining[MARKER_PREFIX.len()..];
                } else {
                    remaining = &remaining[pos..];
                }
            } else {
                passthrough.push_str(remaining);
                remaining = "";
            }
        }

        passthrough
    }

    fn any_in_phase(&self, target: CapturePhase) -> Option<String> {
        self.active
            .iter()
            .find(|(_, cap)| cap.phase == target)
            .map(|(id, _)| id.clone())
    }

    fn try_match_start<'a>(&mut self, text: &'a str) -> Option<MatchResult<'a>> {
        let prefix = format!("{MARKER_PREFIX}START_");
        let start_pos = text.find(&prefix)?;

        let after_prefix = &text[start_pos + prefix.len()..];
        let end_suffix = "__";
        let suffix_pos = after_prefix.find(end_suffix)?;

        let marker_id = &after_prefix[..suffix_pos];

        if !self.active.contains_key(marker_id) {
            return None;
        }

        if let Some(cap) = self.active.get_mut(marker_id) {
            cap.phase = CapturePhase::Capturing;
        }

        let marker_end = start_pos + prefix.len() + suffix_pos + end_suffix.len();
        let after_marker = &text[marker_end..];
        let after = after_marker
            .strip_prefix("\r\n")
            .or_else(|| after_marker.strip_prefix('\n'))
            .unwrap_or(after_marker);

        Some(MatchResult { before: "", after })
    }

    fn try_match_end<'a>(&mut self, text: &'a str) -> Option<MatchResult<'a>> {
        let prefix = format!("{MARKER_PREFIX}END_");
        let start_pos = text.find(&prefix)?;

        let after_prefix = &text[start_pos + prefix.len()..];
        let end_suffix = "__";
        let suffix_pos = after_prefix.find(end_suffix)?;

        let inner = &after_prefix[..suffix_pos];

        let last_underscore = inner.rfind('_')?;
        let marker_id = &inner[..last_underscore];
        let code_str = &inner[last_underscore + 1..];
        let exit_code = code_str.parse::<i32>().ok();

        let capture = self.active.get_mut(marker_id)?;

        let before = &text[..start_pos];
        let marker_end = start_pos + prefix.len() + suffix_pos + end_suffix.len();
        let after_marker = &text[marker_end..];
        let _ = after_marker;

        let mut output = std::mem::take(&mut capture.buffer);
        output.push_str(before);
        let output = output.trim().to_string();

        if let Some(tx) = capture.result_tx.take() {
            let _ = tx.send(CapturedOutput {
                output,
                exit_code,
                duration_ms: capture.start_time.elapsed().as_millis() as u64,
            });
        }

        // Transition to PostCapture to suppress the shell prompt that follows.
        // Also discard any text after the END marker in this chunk.
        capture.phase = CapturePhase::PostCapture;

        Some(MatchResult {
            before: "",
            after: "",
        })
    }

    fn possible_marker_tail_start(&self, text: &str) -> Option<usize> {
        text.char_indices()
            .filter_map(|(idx, _)| self.is_possible_marker_prefix(&text[idx..]).then_some(idx))
            .min_by_key(|idx| *idx)
    }

    fn is_possible_marker_prefix(&self, value: &str) -> bool {
        if value.is_empty() {
            return false;
        }
        if MARKER_PREFIX.starts_with(value) {
            return true;
        }

        self.active.keys().any(|marker_id| {
            let start_marker = format!("{MARKER_PREFIX}START_{marker_id}__");
            if start_marker.starts_with(value) {
                return true;
            }

            let end_prefix = format!("{MARKER_PREFIX}END_{marker_id}_");
            if end_prefix.starts_with(value) {
                return true;
            }
            value.starts_with(&end_prefix)
                && value[end_prefix.len()..]
                    .chars()
                    .all(|ch| ch.is_ascii_digit() || ch == '-')
        })
    }
}

struct MatchResult<'a> {
    before: &'a str,
    after: &'a str,
}

impl Default for OutputCaptureProcessor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn register_capture(
        proc: &mut OutputCaptureProcessor,
        marker_id: &str,
    ) -> oneshot::Receiver<CapturedOutput> {
        let (tx, rx) = oneshot::channel();
        proc.register(marker_id.to_string(), tx);
        rx
    }

    #[test]
    fn builders_do_not_embed_matchable_markers_in_input_text() {
        for profile in [
            AiExecutionProfile::Posix,
            AiExecutionProfile::Powershell,
            AiExecutionProfile::Cmd,
        ] {
            let command = build_capture_command(profile, "marker-1", "echo ok").unwrap();
            assert!(!command.contains("__DF_CMD_START_marker-1__"));
            assert!(!command.contains("__DF_CMD_END_marker-1_0__"));
        }
    }

    #[test]
    fn powershell_builder_is_single_logical_input_line() {
        let command = build_capture_command(
            AiExecutionProfile::Powershell,
            "marker-1",
            "Write-Output 'ok'\r\n# comment",
        )
        .unwrap();
        let command = command.strip_suffix("\r\n").unwrap();

        assert!(!command.contains('\r'));
        assert!(!command.contains('\n'));
        assert!(command.contains("[scriptblock]::Create($nyaiScript)"));
        assert!(!command.contains("Write-Output 'ok'"));
    }

    #[test]
    fn cmd_builder_is_single_logical_input_line() {
        let command =
            build_capture_command(AiExecutionProfile::Cmd, "marker-1", "echo one\r\necho two")
                .unwrap();
        let command = command.strip_suffix("\r\n").unwrap();

        assert!(!command.contains('\r'));
        assert!(!command.contains('\n'));
        assert!(command.contains("echo one & echo two"));
        assert!(command.contains("call echo"));
        assert!(command.contains("^%ERRORLEVEL^%"));
    }

    #[test]
    fn unsupported_profiles_do_not_build_capture_commands() {
        for profile in [
            AiExecutionProfile::Auto,
            AiExecutionProfile::SendOnly,
            AiExecutionProfile::Disabled,
        ] {
            assert!(build_capture_command(profile, "marker-1", "echo ok").is_none());
        }
    }

    #[tokio::test]
    async fn captures_crlf_output_with_prompt_before_markers() {
        let mut proc = OutputCaptureProcessor::new();
        let rx = register_capture(&mut proc, "m1");

        let visible = proc.process(
            "C:\\>echo marker\r\n__DF_CMD_START_m1__\r\nok\r\n__DF_CMD_END_m1_7__\r\nC:\\>",
        );
        assert!(visible.is_empty());

        let captured = rx.await.unwrap();
        assert_eq!(captured.output, "ok");
        assert_eq!(captured.exit_code, Some(7));
    }

    #[tokio::test]
    async fn captures_start_marker_split_across_chunks() {
        let mut proc = OutputCaptureProcessor::new();
        let rx = register_capture(&mut proc, "m2");

        assert!(proc.process("__DF_CMD_STA").is_empty());
        assert!(proc.process("RT_m2__\nhello\n").is_empty());
        assert!(proc.process("__DF_CMD_END_m2_0__\n").is_empty());

        let captured = rx.await.unwrap();
        assert_eq!(captured.output, "hello");
        assert_eq!(captured.exit_code, Some(0));
    }

    #[tokio::test]
    async fn captures_end_marker_split_across_chunks() {
        let mut proc = OutputCaptureProcessor::new();
        let rx = register_capture(&mut proc, "m3");

        assert!(
            proc.process("__DF_CMD_START_m3__\nhello\n__DF_CMD_EN")
                .is_empty()
        );
        assert!(proc.process("D_m3_9__\n").is_empty());

        let captured = rx.await.unwrap();
        assert_eq!(captured.output, "hello");
        assert_eq!(captured.exit_code, Some(9));
    }
}
