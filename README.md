<p align="center">
  <img src="docs/images/openagent-wordmark.png" alt="OpenAgent logo" width="420" />
</p>

# OpenAgent

OpenAgent turns Obsidian Canvas into a local workspace for Codex.

Pick nodes on a canvas, turn them into a task, keep nearby context visible, and write the result back into the graph.

![OpenAgent running inside Obsidian Canvas with a live Codex thread beside the graph](docs/images/openagent-canvas-screenshot.png)

## Demo Video

https://github.com/user-attachments/assets/ac415304-7bc1-4022-b9a4-c6b919734a47

## How It Works

1. Select one or more nodes on a Canvas.
2. Run `OpenAgent: New thread from selection`.
3. OpenAgent sends the selection and nearby markdown context to Codex.
4. Progress streams into Obsidian and the result is written back to the graph.

## Mobile Control with Convos

OpenAgent can also expose your local Codex runtime through Convos.

That means you can:

- run OpenAgent on your Mac
- open a local dashboard that shows a QR code
- scan the QR code with Convos on your phone
- chat from mobile while Codex still runs locally against your real repo on disk

The key idea is simple: Convos is the remote chat surface, but the work still happens on your own machine through the local OpenAgent daemon.

Read the mobile flow in [docs/CONVOS_MOBILE_GUIDE.md](docs/CONVOS_MOBILE_GUIDE.md).

## Quick Start

Requirements:

- macOS
- Node.js 20+
- `pnpm`
- Codex Desktop
- Obsidian Desktop

Recommended setup path: use the bootstrap skill from this repo.

1. Install the Codex skill:

```text
Install the Codex skill from:
https://github.com/openagentmarket/openagent/tree/main/skills/openagent-canvas-bootstrap
```

2. Restart Codex so it picks up the skill.

3. Open the repo you want to use with Codex.
4. Make sure your Obsidian vault is already open.
5. Start a new Codex thread and paste:

```text
Use the openagent-canvas-bootstrap skill to set up OpenAgent for this repo.
```

The bootstrap flow reuses your current vault by default, enables the `OpenAgent` plugin, starts the local runtime, and creates `Workspaces/<repo-name>/Main.canvas`.

To update the installed skill and local OpenAgent checkout later, start a new Codex thread and paste:

```text
Use the openagent-canvas-bootstrap skill to update OpenAgent on this machine.
```

## Plugin Install Artifacts

For the simplest Obsidian plugin install, download the plugin zip from [GitHub Releases](https://github.com/openagentmarket/openagent/releases):

- `openagent-obsidian-plugin-vX.Y.Z.zip`

Extract it into `.obsidian/plugins` in your vault so it creates `.obsidian/plugins/openagent`.

If you prefer the manual path, you can still download:

- `main.js`
- `manifest.json`
- `styles.css`

and copy them into `.obsidian/plugins/openagent`.
Full steps live in [docs/MANUAL_INSTALL.md](docs/MANUAL_INSTALL.md).

## License

Released under the [MIT License](LICENSE).
