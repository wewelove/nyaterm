use crate::error::{AppError, AppResult};
use hex::{decode as hex_decode, encode as hex_encode};
use rand::RngCore;
use russh::{Channel, ChannelMsg, client};
#[cfg(unix)]
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::time::{Duration, timeout};

const MIT_MAGIC_COOKIE: &str = "MIT-MAGIC-COOKIE-1";
const XAUTH_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum X11DisplayTarget {
    Tcp {
        host: String,
        port: u16,
    },
    #[cfg(unix)]
    UnixSocket {
        path: PathBuf,
    },
}

impl X11DisplayTarget {
    pub(crate) fn describe(&self) -> String {
        match self {
            Self::Tcp { host, port } => format!("{host}:{port}"),
            #[cfg(unix)]
            Self::UnixSocket { path } => path.display().to_string(),
        }
    }
}

pub(crate) struct X11ForwardingConfig {
    pub target: X11DisplayTarget,
    pub fallback_target: Option<X11DisplayTarget>,
    pub fake_cookie: Vec<u8>,
    pub fake_cookie_hex: String,
    pub real_cookie: Option<Vec<u8>>,
}

pub(crate) struct X11ChannelOpen {
    pub channel: Channel<client::Msg>,
    pub originator_address: String,
    pub originator_port: u32,
}

pub(crate) fn effective_x11_display(configured: &str) -> String {
    let trimmed = configured.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }

    if cfg!(windows) {
        "localhost:0".to_string()
    } else {
        std::env::var("DISPLAY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| ":0".to_string())
    }
}

pub(crate) async fn prepare_x11_forwarding(configured_display: &str) -> X11ForwardingConfig {
    let display = effective_x11_display(configured_display);
    let (target, fallback_target) = resolve_x11_display_targets(&display);
    let mut fake_cookie = vec![0_u8; 16];
    rand::thread_rng().fill_bytes(&mut fake_cookie);
    let fake_cookie_hex = hex_encode(&fake_cookie);
    let real_cookie = read_local_x11_auth_cookie(&display).await;

    X11ForwardingConfig {
        target,
        fallback_target,
        fake_cookie,
        fake_cookie_hex,
        real_cookie,
    }
}

pub(crate) fn resolve_x11_display_targets(
    display: &str,
) -> (X11DisplayTarget, Option<X11DisplayTarget>) {
    let target = resolve_x11_display_spec(Some(display));

    #[cfg(unix)]
    {
        let fallback = match &target {
            X11DisplayTarget::UnixSocket { .. } => {
                display_number(display).map(|n| X11DisplayTarget::Tcp {
                    host: "localhost".to_string(),
                    port: 6000 + n,
                })
            }
            _ => None,
        };
        (target, fallback)
    }

    #[cfg(not(unix))]
    {
        (target, None)
    }
}

pub(crate) fn resolve_x11_display_spec(display: Option<&str>) -> X11DisplayTarget {
    let value = display
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| if cfg!(windows) { "localhost:0" } else { ":0" });

    #[cfg(unix)]
    if value.starts_with('/') {
        return X11DisplayTarget::UnixSocket {
            path: PathBuf::from(value),
        };
    }

    if let Some(rest) = value.strip_prefix("unix:") {
        let display = parse_display_number(rest).unwrap_or(0);
        return platform_display_target(None, display);
    }

    if let Some(rest) = value.strip_prefix(':') {
        let display = parse_display_number(rest).unwrap_or(0);
        return platform_display_target(None, display);
    }

    if let Some((host, suffix)) = value.rsplit_once(':') {
        let n = parse_display_number(suffix).unwrap_or(0);
        let port = if n >= 100 { n } else { 6000 + n };
        return X11DisplayTarget::Tcp {
            host: host.to_string(),
            port,
        };
    }

    X11DisplayTarget::Tcp {
        host: "localhost".to_string(),
        port: 6000,
    }
}

fn platform_display_target(host: Option<&str>, display: u16) -> X11DisplayTarget {
    #[cfg(unix)]
    {
        if host.is_none() {
            return X11DisplayTarget::UnixSocket {
                path: PathBuf::from(format!("/tmp/.X11-unix/X{display}")),
            };
        }
    }

    X11DisplayTarget::Tcp {
        host: host.unwrap_or("localhost").to_string(),
        port: 6000 + display,
    }
}

fn parse_display_number(value: &str) -> Option<u16> {
    value
        .split('.')
        .next()
        .filter(|part| !part.is_empty())
        .and_then(|part| part.parse::<u16>().ok())
}

fn display_number(display: &str) -> Option<u16> {
    let trimmed = display.trim();
    if let Some(rest) = trimmed.strip_prefix(':') {
        return parse_display_number(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("unix:") {
        return parse_display_number(rest);
    }
    trimmed
        .rsplit_once(':')
        .and_then(|(_host, rest)| parse_display_number(rest))
        .filter(|n| *n < 100)
}

enum LocalX11Stream {
    Tcp(tokio::net::TcpStream),
    #[cfg(unix)]
    Unix(tokio::net::UnixStream),
}

impl AsyncRead for LocalX11Stream {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match &mut *self {
            Self::Tcp(stream) => std::pin::Pin::new(stream).poll_read(cx, buf),
            #[cfg(unix)]
            Self::Unix(stream) => std::pin::Pin::new(stream).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for LocalX11Stream {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        data: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        match &mut *self {
            Self::Tcp(stream) => std::pin::Pin::new(stream).poll_write(cx, data),
            #[cfg(unix)]
            Self::Unix(stream) => std::pin::Pin::new(stream).poll_write(cx, data),
        }
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match &mut *self {
            Self::Tcp(stream) => std::pin::Pin::new(stream).poll_flush(cx),
            #[cfg(unix)]
            Self::Unix(stream) => std::pin::Pin::new(stream).poll_flush(cx),
        }
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match &mut *self {
            Self::Tcp(stream) => std::pin::Pin::new(stream).poll_shutdown(cx),
            #[cfg(unix)]
            Self::Unix(stream) => std::pin::Pin::new(stream).poll_shutdown(cx),
        }
    }
}

async fn connect_local_x_server(target: &X11DisplayTarget) -> std::io::Result<LocalX11Stream> {
    match target {
        X11DisplayTarget::Tcp { host, port } => {
            tokio::net::TcpStream::connect((host.as_str(), *port))
                .await
                .map(LocalX11Stream::Tcp)
        }
        #[cfg(unix)]
        X11DisplayTarget::UnixSocket { path } => tokio::net::UnixStream::connect(path)
            .await
            .map(LocalX11Stream::Unix),
    }
}

async fn connect_local_x_server_with_fallback(
    primary: &X11DisplayTarget,
    fallback: Option<&X11DisplayTarget>,
) -> std::io::Result<LocalX11Stream> {
    match connect_local_x_server(primary).await {
        Ok(stream) => Ok(stream),
        Err(primary_error) => {
            if let Some(fallback) = fallback {
                connect_local_x_server(fallback)
                    .await
                    .map_err(|_| primary_error)
            } else {
                Err(primary_error)
            }
        }
    }
}

async fn read_local_x11_auth_cookie(display: &str) -> Option<Vec<u8>> {
    let xauth = if cfg!(target_os = "macos") && std::path::Path::new("/opt/X11/bin/xauth").exists()
    {
        "/opt/X11/bin/xauth"
    } else {
        "xauth"
    };

    let mut command = tokio::process::Command::new(xauth);
    command
        .arg("list")
        .env("DISPLAY", display)
        .kill_on_drop(true);

    let output = timeout(XAUTH_TIMEOUT, command.output()).await.ok()?.ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    parse_xauth_cookie(&text, display)
}

fn parse_xauth_cookie(output: &str, display: &str) -> Option<Vec<u8>> {
    let display_num = display_number(display);
    let mut fallback = None;

    for line in output.lines() {
        if !line.contains(MIT_MAGIC_COOKIE) {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let Ok(cookie) = hex_decode(parts[2]) else {
            continue;
        };
        if let Some(n) = display_num {
            if line.contains(&format!(":{n}")) {
                return Some(cookie);
            }
        }
        if fallback.is_none() {
            fallback = Some(cookie);
        }
    }

    fallback
}

pub(crate) struct X11AuthRewriter {
    fake_cookie: Vec<u8>,
    real_cookie: Option<Vec<u8>>,
    buffer: Vec<u8>,
    complete: bool,
}

impl X11AuthRewriter {
    pub(crate) fn new(fake_cookie: Vec<u8>, real_cookie: Option<Vec<u8>>) -> Self {
        Self {
            fake_cookie,
            real_cookie,
            buffer: Vec::new(),
            complete: false,
        }
    }

    pub(crate) fn push(&mut self, data: &[u8]) -> Vec<u8> {
        if self.complete {
            return data.to_vec();
        }

        self.buffer.extend_from_slice(data);
        let Some(packet_len) = setup_packet_len(&self.buffer) else {
            return Vec::new();
        };
        if self.buffer.len() < packet_len {
            return Vec::new();
        }

        let mut output = std::mem::take(&mut self.buffer);
        let remainder = output.split_off(packet_len);
        rewrite_x11_auth_setup_packet(&mut output, &self.fake_cookie, self.real_cookie.as_deref());
        output.extend_from_slice(&remainder);
        self.complete = true;
        output
    }
}

fn setup_packet_len(buffer: &[u8]) -> Option<usize> {
    if buffer.len() < 12 {
        return None;
    }
    let byte_order = buffer[0];
    let read_u16 = |offset: usize| -> Option<u16> {
        let bytes = [*buffer.get(offset)?, *buffer.get(offset + 1)?];
        match byte_order {
            b'l' => Some(u16::from_le_bytes(bytes)),
            b'B' => Some(u16::from_be_bytes(bytes)),
            _ => None,
        }
    };

    let auth_protocol_len = read_u16(6)? as usize;
    let auth_data_len = read_u16(8)? as usize;
    Some(12 + pad4(auth_protocol_len) + pad4(auth_data_len))
}

fn pad4(n: usize) -> usize {
    (n + 3) & !3
}

pub(crate) fn rewrite_x11_auth_setup_packet(
    buffer: &mut [u8],
    fake_cookie: &[u8],
    real_cookie: Option<&[u8]>,
) -> bool {
    let Some(real_cookie) = real_cookie else {
        return false;
    };
    if buffer.len() < 12 {
        return false;
    }

    let byte_order = buffer[0];
    let read_u16 = |offset: usize| -> Option<u16> {
        let bytes = [*buffer.get(offset)?, *buffer.get(offset + 1)?];
        match byte_order {
            b'l' => Some(u16::from_le_bytes(bytes)),
            b'B' => Some(u16::from_be_bytes(bytes)),
            _ => None,
        }
    };

    let protocol_len = read_u16(6).unwrap_or(0) as usize;
    let auth_len = read_u16(8).unwrap_or(0) as usize;
    let protocol_start = 12;
    let protocol_end = protocol_start + protocol_len;
    let auth_start = protocol_start + pad4(protocol_len);
    let auth_end = auth_start + auth_len;

    if auth_end > buffer.len() {
        return false;
    }
    if &buffer[protocol_start..protocol_end] != MIT_MAGIC_COOKIE.as_bytes() {
        return false;
    }
    if auth_len != real_cookie.len() || auth_len != fake_cookie.len() {
        return false;
    }
    if &buffer[auth_start..auth_end] != fake_cookie {
        return false;
    }

    buffer[auth_start..auth_end].copy_from_slice(real_cookie);
    true
}

pub(crate) fn local_x_server_error_message(display_target: &str) -> String {
    let platform = if cfg!(windows) {
        X11Platform::Windows
    } else if cfg!(target_os = "macos") {
        X11Platform::Macos
    } else {
        X11Platform::Linux
    };
    local_x_server_error_message_for_platform(display_target, platform)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum X11Platform {
    Windows,
    Macos,
    Linux,
}

fn local_x_server_error_message_for_platform(
    display_target: &str,
    platform: X11Platform,
) -> String {
    let mut lines = vec![
        "[X11] Could not connect to the local X11 server.".to_string(),
        format!("[X11] Display target: {display_target}"),
    ];

    match platform {
        X11Platform::Windows => {
            lines.push(
                "[X11] Windows: install and start VcXsrv or Xming, then try again.".to_string(),
            );
        }
        X11Platform::Macos => {
            lines.push("[X11] macOS: install and start XQuartz, then try again.".to_string());
        }
        X11Platform::Linux => {
            lines.push(
                "[X11] Linux: check DISPLAY and make sure Xorg/Xwayland is running.".to_string(),
            );
        }
    }

    format!("{}\r\n", lines.join("\r\n"))
}

pub(crate) fn enable_failed_message() -> String {
    "[X11] Could not enable X11 forwarding.\r\n[X11] Make sure sshd_config has X11Forwarding yes and xauth is installed on the server.\r\n".to_string()
}

pub(crate) fn spawn_x11_forwarder(
    app: AppHandle,
    session_id: String,
    mut rx: mpsc::UnboundedReceiver<X11ChannelOpen>,
    config: X11ForwardingConfig,
) {
    tokio::spawn(async move {
        while let Some(open) = rx.recv().await {
            let target = config.target.clone();
            let fallback = config.fallback_target.clone();
            let fake_cookie = config.fake_cookie.clone();
            let real_cookie = config.real_cookie.clone();
            let session_id = session_id.clone();
            let app = app.clone();
            tokio::spawn(async move {
                if let Err(error) = handle_x11_channel(
                    app,
                    session_id,
                    open,
                    target,
                    fallback,
                    fake_cookie,
                    real_cookie,
                )
                .await
                {
                    tracing::debug!(%error, "X11 channel forwarding ended with error");
                }
            });
        }
    });
}

async fn handle_x11_channel(
    app: AppHandle,
    session_id: String,
    open: X11ChannelOpen,
    target: X11DisplayTarget,
    fallback: Option<X11DisplayTarget>,
    fake_cookie: Vec<u8>,
    real_cookie: Option<Vec<u8>>,
) -> AppResult<()> {
    tracing::debug!(
        originator_address = %open.originator_address,
        originator_port = open.originator_port,
        target = %target.describe(),
        "Handling X11 channel"
    );

    let local = match connect_local_x_server_with_fallback(&target, fallback.as_ref()).await {
        Ok(stream) => stream,
        Err(error) => {
            let _ = open.channel.close().await;
            let message = local_x_server_error_message(&target.describe());
            let _ = app.emit(
                &format!("terminal-output-{session_id}"),
                crate::core::TerminalOutputPayload {
                    bytes: message.len(),
                    data: message,
                    dropped_bytes: 0,
                },
            );
            return Err(AppError::Channel(format!(
                "Failed to connect local X11 server: {error}"
            )));
        }
    };

    let (mut remote_read, remote_write) = open.channel.split();
    let mut remote_writer = remote_write.make_writer();
    let (mut local_read, mut local_write) = tokio::io::split(local);
    let mut rewriter = X11AuthRewriter::new(fake_cookie, real_cookie);

    let remote_to_local = async {
        while let Some(msg) = remote_read.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    let rewritten = rewriter.push(&data);
                    if !rewritten.is_empty() {
                        local_write.write_all(&rewritten).await?;
                    }
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        let _ = local_write.shutdown().await;
        Ok::<(), std::io::Error>(())
    };

    let local_to_remote = async {
        let mut buf = [0_u8; 16 * 1024];
        loop {
            let n = local_read.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            remote_writer.write_all(&buf[..n]).await?;
        }
        let _ = remote_writer.shutdown().await;
        Ok::<(), std::io::Error>(())
    };

    tokio::select! {
        result = remote_to_local => {
            result.map_err(|error| AppError::Channel(format!("X11 remote-to-local forwarding failed: {error}")))?;
        }
        result = local_to_remote => {
            result.map_err(|error| AppError::Channel(format!("X11 local-to-remote forwarding failed: {error}")))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target_desc(target: X11DisplayTarget) -> String {
        target.describe()
    }

    #[test]
    fn parses_display_specs() {
        assert_eq!(
            target_desc(resolve_x11_display_spec(Some("localhost:0"))),
            "localhost:6000"
        );
        assert_eq!(
            target_desc(resolve_x11_display_spec(Some("localhost:1"))),
            "localhost:6001"
        );
        assert_eq!(
            target_desc(resolve_x11_display_spec(Some("127.0.0.1:0"))),
            "127.0.0.1:6000"
        );
        assert_eq!(
            target_desc(resolve_x11_display_spec(Some("host.example.com:1"))),
            "host.example.com:6001"
        );
        assert_eq!(
            target_desc(resolve_x11_display_spec(Some("localhost:6000"))),
            "localhost:6000"
        );
        assert_eq!(
            target_desc(resolve_x11_display_spec(Some(""))),
            target_desc(resolve_x11_display_spec(None))
        );

        #[cfg(unix)]
        {
            assert_eq!(
                target_desc(resolve_x11_display_spec(Some(":0"))),
                "/tmp/.X11-unix/X0"
            );
            assert_eq!(
                target_desc(resolve_x11_display_spec(Some(":1"))),
                "/tmp/.X11-unix/X1"
            );
            assert_eq!(
                target_desc(resolve_x11_display_spec(Some("unix:0"))),
                "/tmp/.X11-unix/X0"
            );
            assert_eq!(
                target_desc(resolve_x11_display_spec(Some("/tmp/.X11-unix/X0"))),
                "/tmp/.X11-unix/X0"
            );
        }

        #[cfg(windows)]
        {
            assert_eq!(
                target_desc(resolve_x11_display_spec(Some(":0"))),
                "localhost:6000"
            );
            assert_eq!(
                target_desc(resolve_x11_display_spec(Some(":1"))),
                "localhost:6001"
            );
            assert_eq!(
                target_desc(resolve_x11_display_spec(Some("unix:0"))),
                "localhost:6000"
            );
            assert_eq!(
                target_desc(resolve_x11_display_spec(Some("/tmp/.X11-unix/X0"))),
                "localhost:6000"
            );
        }
    }

    fn setup_packet(order: u8, protocol: &[u8], cookie: &[u8]) -> Vec<u8> {
        let mut packet = vec![order, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let protocol_len = protocol.len() as u16;
        let cookie_len = cookie.len() as u16;
        let protocol_bytes = if order == b'l' {
            protocol_len.to_le_bytes()
        } else {
            protocol_len.to_be_bytes()
        };
        let cookie_bytes = if order == b'l' {
            cookie_len.to_le_bytes()
        } else {
            cookie_len.to_be_bytes()
        };
        packet[6..8].copy_from_slice(&protocol_bytes);
        packet[8..10].copy_from_slice(&cookie_bytes);
        packet.extend_from_slice(protocol);
        packet.resize(12 + pad4(protocol.len()), 0);
        packet.extend_from_slice(cookie);
        packet.resize(12 + pad4(protocol.len()) + pad4(cookie.len()), 0);
        packet
    }

    #[test]
    fn rewrites_little_and_big_endian_cookie() {
        let fake = [1_u8; 16];
        let real = [2_u8; 16];

        for order in [b'l', b'B'] {
            let mut packet = setup_packet(order, MIT_MAGIC_COOKIE.as_bytes(), &fake);
            assert!(rewrite_x11_auth_setup_packet(
                &mut packet,
                &fake,
                Some(&real)
            ));
            assert!(packet.windows(real.len()).any(|w| w == real));
            assert!(!packet.windows(fake.len()).any(|w| w == fake));
        }
    }

    #[test]
    fn does_not_rewrite_when_cookie_or_protocol_mismatch() {
        let fake = [1_u8; 16];
        let real = [2_u8; 16];
        let other = [3_u8; 16];

        let mut packet = setup_packet(b'l', MIT_MAGIC_COOKIE.as_bytes(), &other);
        assert!(!rewrite_x11_auth_setup_packet(
            &mut packet,
            &fake,
            Some(&real)
        ));

        let mut packet = setup_packet(b'l', b"OTHER", &fake);
        assert!(!rewrite_x11_auth_setup_packet(
            &mut packet,
            &fake,
            Some(&real)
        ));
    }

    #[test]
    fn rewriter_passes_through_fake_cookie_mismatch() {
        let fake = [1_u8; 16];
        let real = [2_u8; 16];
        let other = [3_u8; 16];
        let packet = setup_packet(b'l', MIT_MAGIC_COOKIE.as_bytes(), &other);
        let mut rewriter = X11AuthRewriter::new(fake.to_vec(), Some(real.to_vec()));

        let output = rewriter.push(&packet);

        assert_eq!(output, packet);
    }

    #[test]
    fn rewriter_passes_through_non_mit_magic_protocol() {
        let fake = [1_u8; 16];
        let real = [2_u8; 16];
        let packet = setup_packet(b'l', b"OTHER", &fake);
        let mut rewriter = X11AuthRewriter::new(fake.to_vec(), Some(real.to_vec()));

        let output = rewriter.push(&packet);

        assert_eq!(output, packet);
    }

    #[test]
    fn rewriter_buffers_fragmented_packet() {
        let fake = [1_u8; 16];
        let real = [2_u8; 16];
        let packet = setup_packet(b'l', MIT_MAGIC_COOKIE.as_bytes(), &fake);
        let mut rewriter = X11AuthRewriter::new(fake.to_vec(), Some(real.to_vec()));

        assert!(rewriter.push(&packet[..8]).is_empty());
        let output = rewriter.push(&packet[8..]);
        assert_eq!(output.len(), packet.len());
        assert!(output.windows(real.len()).any(|w| w == real));
    }

    #[test]
    fn error_messages_are_platform_specific() {
        let message = local_x_server_error_message("localhost:6000");
        assert!(message.contains("[X11] Could not connect"));
        if cfg!(windows) {
            assert!(message.contains("Windows"));
        } else if cfg!(target_os = "macos") {
            assert!(message.contains("macOS"));
        } else {
            assert!(message.contains("Linux"));
        }
    }

    #[test]
    fn builds_error_messages_for_each_supported_platform() {
        let windows =
            local_x_server_error_message_for_platform("localhost:6000", X11Platform::Windows);
        let macos =
            local_x_server_error_message_for_platform("/tmp/.X11-unix/X0", X11Platform::Macos);
        let linux =
            local_x_server_error_message_for_platform("/tmp/.X11-unix/X0", X11Platform::Linux);

        assert!(windows.contains("VcXsrv"));
        assert!(windows.contains("localhost:6000"));
        assert!(macos.contains("XQuartz"));
        assert!(linux.contains("Xorg/Xwayland"));
    }
}
