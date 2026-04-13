<div align="center">
    <img src="./public/dragonfly.svg" alt="Dragonfly Logo" width="100" height="100">
    <h3>Dragonfly is a modern remote terminal workspace built with Tauri and Rust</h3>
</div>

## Overview

Dragonfly is a desktop client for SSH-centric operations and mixed terminal workflows. It combines a React + Tauri interface with a Rust backend so you can manage remote hosts, local shells, file transfers, authentication, and network tooling from one workspace.

## Highlights

### Sessions and workspace

- SSH, Local Terminal, Telnet, and Serial session support
- Multi-tab workspace with horizontal and vertical pane splits
- Saved connections with folders, icons, duplication, reconnect, and import tools
- Child windows for settings, new-session, quick-command, and auto-upload flows

### Terminal experience

- Search bar, command history, fuzzy suggestions, and context actions
- Optional line numbers and timestamps gutter for dense terminal output
- Optional action links for IPv4 addresses, `host:port`, and archive filenames
- Optional keyword highlighting with built-in presets and custom rules
- Session recording, configurable scrollback, and SSH keep-alive
- Remote resource monitor for active SSH sessions

### Remote operations

- Built-in SFTP file explorer with upload, download, rename, move, delete, and properties
- Transfer queue with retry, resume, timestamp preservation, and configurable concurrency
- Open remote files in a local editor and upload changes back through the watcher flow
- Quick Commands with categories, colors, icons, and variable prompts

### Security and networking

- Password auth, private keys, host-key verification, and local credential encryption
- OTP management with TOTP/HOTP, QR import, and SSH auto-fill support
- Screen lock, master password support, and known-hosts management
- Proxy configs, SSH jump hosts, and local / remote / dynamic tunnels

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
- Development docs: [docs-site/docs/development/](docs-site/docs/development)

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
