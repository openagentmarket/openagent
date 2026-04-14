---
name: openagent-canvas-bootstrap
description: Bootstrap or update OpenAgent for Codex plus Obsidian Canvas. Use when the user wants a one-step setup for the current repo, or wants to update the installed OpenAgent skill and local OpenAgent checkout on their machine.
---

# OpenAgent Canvas Bootstrap

Use this skill when the user wants the fastest path from "I have Codex and Obsidian" to "this repo is already wired into an Obsidian Canvas workspace", or when they want to update the installed OpenAgent skill/runtime.

## What this skill does

For setup, run:

```bash
bash "$CODEX_HOME/skills/openagent-canvas-bootstrap/scripts/bootstrap-openagent-current-repo.sh"
```

The script uses the current working directory as the target repo unless `OPENAGENT_TARGET_REPO` is set.
By default it reuses the Obsidian vault the user currently has open.

For updates, run:

```bash
bash "$CODEX_HOME/skills/openagent-canvas-bootstrap/scripts/update-openagent-install.sh"
```

## Defaults

- Installs or reuses the OpenAgent source at `~/.openagent/source/openagent`
- Reuses the currently open Obsidian vault when one is available
- Opens Obsidian after bootstrap
- Starts the daemon unless the caller passes `--skip-daemon-start`

## Useful overrides

- `OPENAGENT_TARGET_REPO`: bootstrap a repo other than the current working directory
- `OPENAGENT_INSTALL_DIR`: change where the OpenAgent source is cloned
- `OPENAGENT_VAULT_PATH`: force a specific existing Obsidian vault path
- `OPENAGENT_VAULT_ROOT`: create a dedicated vault under this folder instead of reusing the open vault
- `OPENAGENT_VAULT_NAME`: override the dedicated vault name when using `OPENAGENT_VAULT_ROOT`
- `OPENAGENT_WORKSPACE_NAME`: override the generated workspace name
- `OPENAGENT_UPDATE=1`: pull the latest OpenAgent changes before bootstrapping

## Workflow

1. If the user asks to update OpenAgent or this skill, run the update script and tell them to restart Codex after it finishes.
2. Otherwise, confirm the user is on macOS and already has Obsidian Desktop plus Codex installed.
3. Run the bootstrap script from the current project.
4. If the script succeeds, tell the user the vault path and remind them they can start from the generated `Main.canvas`.
5. If Obsidian did not focus the canvas automatically, tell the user to open `Workspaces/<repo-slug>/Main.canvas` inside their current vault.

## Notes

- Prefer the script over manually restating the shell steps.
- The script is idempotent: rerunning it should reuse the same OpenAgent checkout, vault, plugin wiring, and workspace when possible.
