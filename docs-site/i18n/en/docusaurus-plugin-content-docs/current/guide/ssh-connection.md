---
sidebar_position: 1
---

# SSH Connection Management

SSH is still NyaTerm's most complete session type. Beyond a basic login, an SSH connection can also be tied to:

- SFTP file explorer
- Remote resource monitoring
- Proxy
- Jump host
- OTP binding and auto-fill
- Port tunnels

If you are new to NyaTerm, it usually makes sense to configure SSH first, then expand into file workflows, terminal enhancements, and network features.

## Create an SSH connection

In the **New Session** window, switch to the **SSH** tab and fill in these fields.

### Basic information

| Field | Description |
|------|------|
| Connection Name | Display name in the saved-connections list |
| Host | Server IP or domain |
| Port | Defaults to `22` |
| Username | Login user |
| Icon | Helps distinguish services or environments |
| Group | Organizes connections into folders |
| Description | Notes about the environment or purpose |

### Authentication methods

NyaTerm supports two common SSH authentication methods:

- **Password**
- **Private key**

You can select saved passwords or saved keys instead of re-entering them every time.

#### Password authentication

Useful for:

- Temporary test hosts
- Environments that have not issued private keys yet
- Accounts that are combined with OTP

#### Private key authentication

Useful for:

- Daily operations work
- Reusing one identity across many hosts
- Workflows that involve jump hosts or automation

Both passwords and keys can be managed centrally in **Security/Auth**.

## Advanced configuration

The advanced section is where an SSH connection goes from "can connect" to "fits a real daily workflow."

### Proxy

If the connection must go through a proxy, you can select a saved proxy profile.

Supported proxy types:

- **SOCKS5**
- **HTTP**

A proxy record can store:

- Name
- Protocol
- Host
- Port
- Username / password

### Jump host

If the target host is not directly reachable, you can pick another saved SSH connection as the **jump host**.

Typical cases include:

- Connecting through a bastion host
- Reaching internal production hosts
- Multi-hop SSH login chains

### OTP binding

If the environment requires a second-factor code, you can bind an OTP entry to the SSH connection.

After binding, you can either:

- Quickly inspect the code during login
- Enable **auto-fill OTP** for compatible interactive prompts

This works well together with [OTP & Authentication](./otp-and-auth).

## Manage saved connections

After saving, the connection appears in the **Saved Connections** panel on the right.

Common operations include:

- Double-click to connect
- Organize by group
- Edit an existing connection
- Duplicate a connection as a template
- Reconnect from an existing saved source

If you manage many hosts, using groups, icons, and descriptions helps separate environments, projects, and roles.

## Import sessions from other clients

NyaTerm can import session definitions from other terminal clients. Current supported imports are:

- **Xshell** (`.xts`)
- **MobaXterm** (`.mxtsessions`)
- **WindTerm** (`.sessions`)

After importing, it is a good idea to verify:

- Host and port
- Username
- Whether proxy / jump host / OTP binding still needs to be added
- Whether saved passwords or keys are already matched correctly

## Host key policy

NyaTerm maintains known-host records and offers three SSH host key policies:

| Policy | Behavior |
|------|------|
| Prompt | Ask whether to trust an unknown host key on first connect (default) |
| Accept | Automatically accept and record new host keys |
| Strict | Reject all unknown host keys |

Known host records are stored in local storage at `~/.nyaterm/nyaterm.redb`; legacy `known_hosts` is imported on first launch.

If you operate in a stricter environment, verify the host key source before accepting it.

## When should you choose SSH?

SSH is the right first choice when:

- You need the file explorer or SFTP
- You need OTP, jump hosts, proxies, or tunnels
- You need remote resource monitoring
- You want a saved connection you can reuse long term

If you only want a local shell inside NyaTerm, use **Local Terminal** from [Session Types](./session-types) instead.

:::tip Screenshot suggestion
- Suggested image path: `/img/docs/session-types/ssh-advanced-form.png`
- Show the SSH form with host, authentication, and the advanced area for proxy / jump host / OTP binding
- Another good image path: `/img/docs/network/ssh-import-and-groups.png`
- Show saved-connection groups and the import entry
:::
