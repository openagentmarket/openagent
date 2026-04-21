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

Start here:

- [README Quick Start](https://github.com/openagentmarket/openagent/blob/main/README.md#quick-start)

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
