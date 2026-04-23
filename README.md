<div align="center">
    <img src="./public/dragonfly.svg" alt="Dragonfly Logo" width="100" height="100">
    <h3>Dragonfly is a modern remote terminal workspace built with Tauri and Rust</h3>
</div>

## Overview

Dragonfly is a desktop client for SSH-centric operations and mixed terminal workflows. It combines a React + Tauri interface with a Rust backend so you can manage remote hosts, local shells, file transfers, authentication, network tooling, session import / export, diagnostics, and protected configuration sync / backup workflows from one workspace.

## Highlights

### Sessions and workspace

- SSH, Local Terminal, Telnet, and Serial session support
- Multi-tab workspace with horizontal and vertical pane splits
- Saved connections with folders, icons, duplication, reconnect, and import tools
- Child windows for settings, new-session, quick-command, and auto-upload flows
- Tray support with optional minimize-to-tray behavior on window close

### Terminal experience

- Search bar, command history, fuzzy suggestions, online search, translation, and context actions
- Configurable command suggestion history length thresholds for noisy or long commands
- Optional line numbers and timestamps gutter for dense terminal output
- Optional action links for IPv4 addresses, `host:port`, and archive filenames
- Optional keyword highlighting with built-in presets and custom rules
- Large-output protection under load, configurable scrollback, and SSH keep-alive
- Session recording with configurable save path and remote resource monitor for active SSH sessions

### Remote operations

- Built-in SFTP file explorer with upload, download, rename, move, delete, symlink, and properties
- Folder upload, multi-select actions, editable path bar, and manual / automatic sync with terminal cwd
- Open remote files in a local editor and upload changes back through the watcher flow
- Windows support for dragging local files or folders directly into the file explorer to upload
- Quick Commands with categories, colors, icons, execution modes, pinning, and variable prompts

### Security and networking

- Password auth, private keys, host-key verification, and local encrypted credential storage
- OTP management with TOTP/HOTP, QR import, and SSH auto-fill support
- Screen lock, master password support, and known-hosts management
- Proxy configs, SSH jump hosts, and local / remote / dynamic tunnels
- Diagnostics settings, local log management, and diagnostics bundle export for troubleshooting

### Sync, backup, and portability

- Encrypted cloud sync and backup for portable Dragonfly data through WebDAV and S3-compatible storage
- Master password required before enabling sync, running manual actions, importing / exporting encrypted config backups, or creating scheduled encrypted backups
- Startup sync checks, debounced auto-push after supported local changes, and scheduled backup retention policies
- Manual test / push / pull / backup actions, remote backup restore, and snapshot-level conflict resolution
- Session import from Xshell, MobaXterm, and WindTerm, plus full-app encrypted `.dgfy` import / export

## Supported session types

| Type | Typical use | Notes |
|------|-------------|-------|
| SSH | Linux / Unix remote servers | Supports SFTP, OTP, resource monitor, proxy, jump host, tunnels |
| Local Terminal | Local shell workflows | Uses your local shell path and working directory |
| Telnet | Legacy network devices / lab systems | Lightweight terminal session without SSH-only features |
| Serial | Routers, boards, embedded devices | Configurable port, baud rate, parity, stop bits |

## Documentation map

The detailed user docs live in `docs-site/`.

- Product overview: [docs-site/docs/intro.md](docs-site/docs/intro.md)
- Quick start: [docs-site/docs/getting-started/quick-start.md](docs-site/docs/getting-started/quick-start.md)
- Guides: [docs-site/docs/guide/](docs-site/docs/guide)
- File transfer guide: [docs-site/docs/guide/file-transfer.md](docs-site/docs/guide/file-transfer.md)
- Sync and backup guide: [docs-site/docs/guide/sync-and-backup.md](docs-site/docs/guide/sync-and-backup.md)
- Development docs: [docs-site/docs/development/](docs-site/docs/development)

The docs site ships with Simplified Chinese by default and English under `/en/`.

## Screenshot placeholders

If you want to add screenshots later, these are the recommended stable asset paths to use in the docs site:

- `docs-site/static/img/docs/readme/main-workspace.png` — main workspace with split panes and both side panels
- `docs-site/static/img/docs/readme/session-types.png` — new-session window showing SSH / Local / Telnet / Serial tabs
- `docs-site/static/img/docs/readme/terminal-features.png` — gutter, action links, and highlight demo output
- `docs-site/static/img/docs/readme/network-and-security.png` — proxy / tunnel / OTP related UI

## Tech stack

| Layer | Technology |
|------|------------|
| Frontend | React 19, TypeScript, Vite, TailwindCSS 4 |
| Desktop runtime | Tauri 2 |
| Backend | Rust |
| Terminal | xterm.js |
| SSH | russh |
| File transfer | russh-sftp |
| Storage abstraction | OpenDAL |

## Getting started

### Prerequisites

- Node.js 18+
- Rust stable via [rustup](https://rustup.rs/)
- pnpm recommended

### Installation

```bash
git clone https://git.coderkang.top/Tauri/dragonfly.git
cd dragonfly
pnpm install
```

### Run the app in development

```bash
pnpm tauri dev
```

### Run the docs site locally

```bash
pnpm --dir docs-site start
```

This builds and serves all locales, so both `/` and `/en/` are available.

For locale-specific hot reload during editing:

```bash
pnpm --dir docs-site start:zh
pnpm --dir docs-site start:en
```

### Build

```bash
pnpm build
pnpm tauri build
pnpm --dir docs-site build
```

The desktop bundles are generated under `src-tauri/target/release/bundle`.

## Contributing

Please read the docs under [docs-site/docs/development/](docs-site/docs/development) before contributing.

## License

[MIT](LICENSE)
