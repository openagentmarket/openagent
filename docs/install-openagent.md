---
title: Install OpenAgent
---

# Install OpenAgent

Use this page if your goal is simple:

**Get OpenAgent running with the least confusion.**

## Choose Your Install Path

### Recommended: bootstrap flow

Use this if you want the fastest supported setup for normal usage.

What it does:

- installs or updates the OpenAgent bootstrap skill
- reuses your existing Obsidian vault
- enables the OpenAgent plugin
- starts the local runtime
- creates `Workspaces/<repo-name>/Main.canvas`

Use this order:

1. Install the Codex skill from:

```text
https://github.com/openagentmarket/openagent/tree/main/skills/openagent-canvas-bootstrap
```

2. Restart Codex so it picks up the skill.
3. Open the repo you want to use with Codex.
4. Make sure your Obsidian vault is already open.
5. Start a new Codex thread and paste:

```text
Use the openagent-canvas-bootstrap skill to set up OpenAgent for this repo.
```

For the full repo-level quick start, see the [README Quick Start](https://github.com/openagentmarket/openagent/blob/main/README.md#quick-start).

To update the installed skill and local OpenAgent checkout later, start a new Codex thread and paste:

```text
Use the openagent-canvas-bootstrap skill to update OpenAgent on this machine.
```

### Manual: plugin install by hand

Use this if you want to control the plugin install yourself.

Start here:

- [Manual Install](./getting-started/manual-install.md)

## What You Need

For the main Obsidian workflow:

- macOS
- Node.js 20+
- `pnpm`
- Codex Desktop
- Obsidian Desktop

For the mobile path, you also need:

- Convos on your phone
- the XMTP environment setup described in the [Mobile Guide](./getting-started/mobile-guide.md)

## What To Do After Install

Once installation is complete, do not jump straight into architecture docs.

Use this order:

1. [Use OpenAgent in Obsidian](./use-openagent-in-obsidian.md)
2. [OpenAgent User Guide](./getting-started/user-guide.md)
3. [Group Context](./concepts/group-context.md) if your selections include grouped markdown context

## If You Only Need The Plugin Files

If you already know how you want to install the plugin, use:

- [GitHub Releases](https://github.com/openagentmarket/openagent/releases)
- [Manual Install](./getting-started/manual-install.md)

## If Installation Fails

Use these docs next:

- [OpenAgent User Guide Troubleshooting](./getting-started/user-guide.md#troubleshooting)
- [Plugin Development](./engineering/plugin-development.md) if you are debugging the local plugin development loop
