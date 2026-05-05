---
sidebar_position: 4
---

# Quick Commands

Quick Commands let you save common commands as reusable actions, then send them to the current terminal from inside the workspace.

## Good use cases

- Frequently repeated operational commands
- Deployment or troubleshooting scripts with parameters
- Organizing commands by product, environment, or team
- Placing risky commands into the prompt first so you can review them before execution

## Create a quick command

1. Open the **Quick Commands** area in the bottom helper section or side panel
2. Click **Add**
3. Fill in the command details in the dedicated child window

Available fields include:

| Field | Description |
|------|------|
| Label | Display name for the command |
| Category | Command grouping |
| Description | Optional note |
| Color Tag | Custom display color |
| Icon | Custom icon |
| Pin to Top | Whether it stays near the top of the list |
| Execution Mode | Execute immediately or append to the input line |
| Command Script | The command text to send |

After saving, the command appears in the list and can still be edited or deleted later.

## Execution modes

### Execute immediately

Clicking the command sends it to the current terminal and runs it at once. Good for:

- Well-understood routine commands
- Daily inspection tasks
- Fixed-format read-only queries

### Append to prompt

Clicking the command only inserts it into the current input line without pressing Enter. Good for:

- Commands whose parameters still need checking
- Script fragments that usually need a small edit
- Higher-risk operations that should be reviewed manually first

## Variable prompts

Command scripts support `{{variableName}}` placeholders for dynamic parameters, for example:

```bash
docker exec -it {{container_name}} bash
```

When you run the command, NyaTerm opens a variable input dialog so the template can be completed before sending it.

## Categories, search, and pinned items

The Quick Commands panel supports these management patterns:

- Search by label, command content, or description
- Filter by category from the dropdown
- Keep pinned commands at the top
- Reuse existing categories when creating new commands

That makes it useful for organizing sets like:

- Kubernetes
- Docker
- Database
- Release scripts
- Environment inspection

## How it fits the workspace

Quick Commands are not tied to one specific session type. As long as the current terminal can accept input, you can send commands to:

- SSH sessions
- Local Terminal sessions
- Some serial workflows that need repeated fixed input

Common combinations include:

- Watching logs on one side while triggering diagnostics from Quick Commands on the other
- Running deploy commands remotely while building or using Git locally
- Turning variable-based commands into team-friendly templates
