//! SSH tunnel manager for local, remote, and dynamic (SOCKS5) port forwarding.

use super::{SshHandle, SshRawHandle, create_ssh_handle};
use crate::config::{self, TunnelConfig};
use crate::error::{AppError, AppResult};
use crate::observability::{StructuredLog, StructuredLogLevel, log_event, log_rate_limited};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, oneshot};

struct TunnelHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    _ssh_handle: SshHandle,
}

pub struct TunnelManager {
    active: Arc<Mutex<HashMap<String, TunnelHandle>>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn is_open(&self, tunnel_id: &str) -> bool {
        self.active.lock().await.contains_key(tunnel_id)
    }

    pub async fn active_count(&self) -> usize {
        self.active.lock().await.len()
    }

    pub async fn open(&self, tunnel: &TunnelConfig, app: &AppHandle) -> AppResult<()> {
        {
            let active = self.active.lock().await;
            if active.contains_key(&tunnel.id) {
                return Ok(());
            }
        }

        let ssh_handle = create_ssh_handle(
            app,
            tunnel
                .connection_id
                .as_deref()
                .ok_or_else(|| AppError::Channel("Tunnel has no connection_id".to_string()))?,
        )
        .await?;
        let target_handle = ssh_handle.target_handle();

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let bind_addr = if tunnel.bind_localhost {
            "127.0.0.1"
        } else {
            "0.0.0.0"
        };

        match tunnel.tunnel_type.as_str() {
            "local" => {
                let listener = TcpListener::bind(format!("{}:{}", bind_addr, tunnel.listen_port))
                    .await
                    .map_err(|e| {
                        AppError::Channel(format!(
                            "Failed to bind local port {}: {}",
                            tunnel.listen_port, e
                        ))
                    })?;
                let target_host = tunnel.target_host.clone();
                let target_port = tunnel.target_port;
                tokio::spawn(Self::run_local_tunnel(
                    listener,
                    target_handle,
                    target_host,
                    target_port,
                    shutdown_rx,
                ));
            }
            "remote" => {
                let target_host = tunnel.target_host.clone();
                let target_port = tunnel.target_port;
                let listen_port = tunnel.listen_port;
                let listen_addr = bind_addr.to_string();
                tokio::spawn(Self::run_remote_tunnel(
                    target_handle,
                    listen_addr,
                    listen_port,
                    target_host,
                    target_port,
                    shutdown_rx,
                ));
            }
            "dynamic" => {
                let listener = TcpListener::bind(format!("{}:{}", bind_addr, tunnel.listen_port))
                    .await
                    .map_err(|e| {
                        AppError::Channel(format!(
                            "Failed to bind SOCKS5 port {}: {}",
                            tunnel.listen_port, e
                        ))
                    })?;
                tokio::spawn(Self::run_dynamic_tunnel(
                    listener,
                    target_handle,
                    shutdown_rx,
                ));
            }
            other => {
                return Err(AppError::Channel(format!("Unknown tunnel type: {}", other)));
            }
        }

        self.active.lock().await.insert(
            tunnel.id.clone(),
            TunnelHandle {
                shutdown_tx: Some(shutdown_tx),
                _ssh_handle: ssh_handle,
            },
        );

        log_event(StructuredLog {
            level: StructuredLogLevel::Info,
            domain: "session.lifecycle".to_string(),
            event: "tunnel.opened".to_string(),
            message: "Tunnel opened".to_string(),
            ids: Some(serde_json::json!({
                "tunnel_id": tunnel.id.clone(),
                "connection_id": tunnel.connection_id.clone(),
            })),
            data: Some(serde_json::json!({
                "tunnel_type": tunnel.tunnel_type.clone(),
                "listen_port": tunnel.listen_port,
                "target_host": tunnel.target_host.clone(),
                "target_port": tunnel.target_port,
                "bind_localhost": tunnel.bind_localhost,
            })),
            error: None,
            client_timestamp: None,
        });
        Ok(())
    }

    pub async fn close(&self, tunnel_id: &str) {
        let mut active = self.active.lock().await;
        if let Some(mut handle) = active.remove(tunnel_id) {
            if let Some(tx) = handle.shutdown_tx.take() {
                let _ = tx.send(());
            }
            log_event(StructuredLog {
                level: StructuredLogLevel::Info,
                domain: "session.lifecycle".to_string(),
                event: "tunnel.closed".to_string(),
                message: "Tunnel closed".to_string(),
                ids: Some(serde_json::json!({ "tunnel_id": tunnel_id })),
                data: None,
                error: None,
                client_timestamp: None,
            });
        }
    }

    async fn run_local_tunnel(
        listener: TcpListener,
        ssh_handle: SshRawHandle,
        target_host: String,
        target_port: u16,
        mut shutdown_rx: oneshot::Receiver<()>,
    ) {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                accept = listener.accept() => {
                    match accept {
                        Ok((mut local_stream, peer_addr)) => {
                            let handle_mtx = ssh_handle.clone();
                            let host = target_host.clone();
                            tokio::spawn(async move {
                                let channel = {
                                    let handle = handle_mtx.lock().await;
                                    match handle.channel_open_direct_tcpip(
                                        &host,
                                        target_port.into(),
                                        &peer_addr.ip().to_string(),
                                        peer_addr.port().into(),
                                    ).await {
                                        Ok(ch) => ch,
                                        Err(e) => {
                                            log_rate_limited(StructuredLog {
                                                level: StructuredLogLevel::Warn,
                                                domain: "session.lifecycle".to_string(),
                                                event: "tunnel.direct_tcpip_failed".to_string(),
                                                message: "Tunnel direct-tcpip failed".to_string(),
                                                ids: None,
                                                data: Some(serde_json::json!({
                                                    "target_host": host,
                                                    "target_port": target_port,
                                                })),
                                                error: Some(serde_json::json!({ "message": e.to_string() })),
                                                client_timestamp: None,
                                            });
                                            return;
                                        }
                                    }
                                };
                                let mut stream = channel.into_stream();
                                let _ = tokio::io::copy_bidirectional(&mut local_stream, &mut stream).await;
                            });
                        }
                        Err(e) => {
                            log_rate_limited(StructuredLog {
                                level: StructuredLogLevel::Warn,
                                domain: "session.lifecycle".to_string(),
                                event: "tunnel.accept_failed".to_string(),
                                message: "Tunnel TCP accept failed".to_string(),
                                ids: None,
                                data: None,
                                error: Some(serde_json::json!({ "message": e.to_string() })),
                                client_timestamp: None,
                            });
                        }
                    }
                }
            }
        }
    }

    async fn run_remote_tunnel(
        ssh_handle: SshRawHandle,
        listen_addr: String,
        listen_port: u16,
        _target_host: String,
        _target_port: u16,
        shutdown_rx: oneshot::Receiver<()>,
    ) {
        {
            let handle = ssh_handle.lock().await;
            if let Err(e) = handle.tcpip_forward(&listen_addr, listen_port.into()).await {
                log_rate_limited(StructuredLog {
                    level: StructuredLogLevel::Warn,
                    domain: "session.lifecycle".to_string(),
                    event: "tunnel.forward_request_failed".to_string(),
                    message: "Remote tunnel forward request failed".to_string(),
                    ids: None,
                    data: Some(serde_json::json!({
                        "listen_addr": listen_addr.clone(),
                        "listen_port": listen_port,
                    })),
                    error: Some(serde_json::json!({ "message": e.to_string() })),
                    client_timestamp: None,
                });
                return;
            }
        }
        log_event(StructuredLog {
            level: StructuredLogLevel::Info,
            domain: "session.lifecycle".to_string(),
            event: "tunnel.forward_requested".to_string(),
            message: "Remote tunnel forwarding requested".to_string(),
            ids: None,
            data: Some(serde_json::json!({
                "listen_addr": listen_addr.clone(),
                "listen_port": listen_port,
            })),
            error: None,
            client_timestamp: None,
        });

        let _ = shutdown_rx.await;

        let handle = ssh_handle.lock().await;
        let _ = handle
            .cancel_tcpip_forward(&listen_addr, listen_port.into())
            .await;
    }

    async fn run_dynamic_tunnel(
        listener: TcpListener,
        ssh_handle: SshRawHandle,
        mut shutdown_rx: oneshot::Receiver<()>,
    ) {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                accept = listener.accept() => {
                    match accept {
                        Ok((stream, peer_addr)) => {
                            let handle = ssh_handle.clone();
                            tokio::spawn(Self::handle_socks5_connection(stream, handle, peer_addr));
                        }
                        Err(e) => {
                            log_rate_limited(StructuredLog {
                                level: StructuredLogLevel::Warn,
                                domain: "session.lifecycle".to_string(),
                                event: "tunnel.socks_accept_failed".to_string(),
                                message: "SOCKS5 accept failed".to_string(),
                                ids: None,
                                data: None,
                                error: Some(serde_json::json!({ "message": e.to_string() })),
                                client_timestamp: None,
                            });
                        }
                    }
                }
            }
        }
    }

    async fn handle_socks5_connection(
        mut stream: tokio::net::TcpStream,
        ssh_handle: SshRawHandle,
        peer_addr: std::net::SocketAddr,
    ) {
        let mut buf = [0u8; 2];
        if stream.read_exact(&mut buf).await.is_err() {
            return;
        }
        if buf[0] != 0x05 {
            return;
        }
        let nmethods = buf[1] as usize;
        let mut methods = vec![0u8; nmethods];
        if stream.read_exact(&mut methods).await.is_err() {
            return;
        }
        if stream.write_all(&[0x05, 0x00]).await.is_err() {
            return;
        }

        let mut header = [0u8; 4];
        if stream.read_exact(&mut header).await.is_err() {
            return;
        }
        if header[0] != 0x05 || header[1] != 0x01 {
            let _ = stream
                .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await;
            return;
        }

        let (target_host, target_port) = match header[3] {
            0x01 => {
                let mut addr = [0u8; 4];
                if stream.read_exact(&mut addr).await.is_err() {
                    return;
                }
                let host = format!("{}.{}.{}.{}", addr[0], addr[1], addr[2], addr[3]);
                let mut port_buf = [0u8; 2];
                if stream.read_exact(&mut port_buf).await.is_err() {
                    return;
                }
                (host, u16::from_be_bytes(port_buf))
            }
            0x03 => {
                let mut len = [0u8; 1];
                if stream.read_exact(&mut len).await.is_err() {
                    return;
                }
                let mut domain = vec![0u8; len[0] as usize];
                if stream.read_exact(&mut domain).await.is_err() {
                    return;
                }
                let host = String::from_utf8_lossy(&domain).to_string();
                let mut port_buf = [0u8; 2];
                if stream.read_exact(&mut port_buf).await.is_err() {
                    return;
                }
                (host, u16::from_be_bytes(port_buf))
            }
            0x04 => {
                let mut addr = [0u8; 16];
                if stream.read_exact(&mut addr).await.is_err() {
                    return;
                }
                let host = std::net::Ipv6Addr::from(addr).to_string();
                let mut port_buf = [0u8; 2];
                if stream.read_exact(&mut port_buf).await.is_err() {
                    return;
                }
                (host, u16::from_be_bytes(port_buf))
            }
            _ => return,
        };

        let channel = match {
            let handle = ssh_handle.lock().await;
            handle
                .channel_open_direct_tcpip(
                    &target_host,
                    target_port.into(),
                    &peer_addr.ip().to_string(),
                    peer_addr.port().into(),
                )
                .await
        } {
            Ok(ch) => ch,
            Err(e) => {
                log_rate_limited(StructuredLog {
                    level: StructuredLogLevel::Warn,
                    domain: "session.lifecycle".to_string(),
                    event: "tunnel.socks_direct_tcpip_failed".to_string(),
                    message: "SOCKS5 direct-tcpip failed".to_string(),
                    ids: None,
                    data: Some(serde_json::json!({
                        "target_host": target_host,
                        "target_port": target_port,
                    })),
                    error: Some(serde_json::json!({ "message": e.to_string() })),
                    client_timestamp: None,
                });
                let _ = stream
                    .write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await;
                return;
            }
        };

        let _ = stream
            .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await;

        let mut ssh_stream = channel.into_stream();
        let _ = tokio::io::copy_bidirectional(&mut stream, &mut ssh_stream).await;
    }

    /// Auto-open tunnels for a connection that just connected.
    pub async fn auto_open_for_connection(&self, app: &AppHandle, connection_id: &str) {
        let tunnels = match config::load_tunnels(app) {
            Ok(t) => t,
            Err(_) => return,
        };

        for tunnel in &tunnels {
            if tunnel.auto_open && tunnel.connection_id.as_deref() == Some(connection_id) {
                if let Err(e) = self.open(tunnel, app).await {
                    log_event(StructuredLog {
                        level: StructuredLogLevel::Warn,
                        domain: "session.lifecycle".to_string(),
                        event: "tunnel.auto_open_failed".to_string(),
                        message: "Failed to auto-open tunnel".to_string(),
                        ids: Some(serde_json::json!({
                            "tunnel_id": tunnel.id.clone(),
                            "connection_id": connection_id,
                        })),
                        data: Some(serde_json::json!({
                            "tunnel_type": tunnel.tunnel_type.clone(),
                        })),
                        error: Some(serde_json::json!({ "message": e.to_string() })),
                        client_timestamp: None,
                    });
                }
            }
        }
    }

    /// Close all auto-open tunnels associated with a connection.
    pub async fn close_auto_tunnels_for_connection(&self, app: &AppHandle, connection_id: &str) {
        let tunnels = match config::load_tunnels(app) {
            Ok(t) => t,
            Err(_) => return,
        };

        for tunnel in &tunnels {
            if tunnel.auto_open && tunnel.connection_id.as_deref() == Some(connection_id) {
                self.close(&tunnel.id).await;
            }
        }
    }
}
