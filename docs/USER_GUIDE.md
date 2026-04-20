# OpenAgent User Guide

This guide is for using OpenAgent from Obsidian once the repo is already set up.

For installation and bootstrap, start with the root [README](https://github.com/openagentmarket/openagent/blob/main/README.md).

If you want a quick reference for native Obsidian Canvas interactions and shortcuts, read [docs/OBSIDIAN_CANVAS_REFERENCE.md](./OBSIDIAN_CANVAS_REFERENCE.md).

If you want to use OpenAgent from your phone through Convos while still running Codex locally on your Mac, read [docs/CONVOS_MOBILE_GUIDE.md](./CONVOS_MOBILE_GUIDE.md).

## What OpenAgent Does

OpenAgent turns an Obsidian Canvas selection into a Codex task that stays attached to the graph.

The usual loop is:

1. Create or open a workspace for a real repo on disk.
2. Open a Canvas inside that workspace.
3. Select one or more nodes.
4. Run `OpenAgent: New thread from selection`.
5. Let the daemon launch or resume a Codex thread.
6. Read the result in the OpenAgent panel and on the Canvas result node.

## Core Concepts

### Workspace

A workspace is a vault folder under `Workspaces/` that points to one real repo on disk.

Each workspace contains:

- a `workspace.json` file with the repo path and default canvas
- a `Main.canvas` file that acts as the visual home for that repo

### Canvas Selection

OpenAgent reads the currently selected Canvas nodes and turns them into prompt context.

Today the main context types are:

- text nodes
- markdown file nodes
- image file nodes
- node links and local Canvas structure used to recover follow-up context

If you are new to Canvas itself, the fastest supporting reference is [docs/OBSIDIAN_CANVAS_REFERENCE.md](./OBSIDIAN_CANVAS_REFERENCE.md).

### Task

A task is the durable record OpenAgent keeps for one selection + repo combination.

A task stores:

- the selected repo working directory
- the saved Canvas selection context
- the Codex thread id, once created
- streamed messages and tool output
- Canvas binding metadata used for result-node sync

### Result Node

When a task completes, the plugin writes the assistant result back into the Canvas as a node plus edge metadata. Follow-up prompts can then continue from that result node.

## Commands

The plugin currently registers these commands:

- `OpenAgent: New thread from selection`
- `OpenAgent: Create follow-up node`
- `OpenAgent: Choose workspace`
- `OpenAgent: Open tasks`
- `OpenAgent: Resume last task`
- `OpenAgent: Stop active task`
- `OpenAgent: Auto arrange active canvas`
- `OpenAgent: Start daemon`

## Settings

OpenAgent currently exposes these settings in Obsidian:

- `Workspace root`
  The vault folder where repo workspaces are created. Default: `Workspaces`.
- `Daemon launch command`
  Optional shell command the plugin runs if the daemon is offline.
- `Daemon launch directory`
  Optional working directory used by the launch command.
- `Codex sandbox mode`
  `Workspace only (safer)` keeps Codex inside the selected repo folder.
  `Full access (advanced)` removes that filesystem boundary for trusted work.
- `Workspace`
  Shortcut button to create or open a repo workspace.
- `Start daemon now`
  Manual warm-up button for the local daemon.

## Normal Workflow

### 1. Choose a Workspace

Run `OpenAgent: Choose workspace` and point it at the repo you want Codex to use.

OpenAgent will create a workspace folder in your vault and a default `Main.canvas` if one does not exist yet.

### 2. Select Context on Canvas

Select one or more nodes that should become the prompt context.

Typical patterns:

- one text node with a focused request
- a text node plus nearby markdown file nodes
- one image file node by itself
- one text node plus connected image file nodes
- a text node inside a group whose markdown file nodes should become default group context
- a previous assistant result node plus a follow-up request node

### 3. Start a Thread

Run `OpenAgent: New thread from selection`.

OpenAgent will:

1. resolve the selected nodes into structured context
2. create or reuse a task
3. make sure the daemon is running
4. create or resume a Codex thread
5. stream progress into the OpenAgent panel

For new threads, OpenAgent also supports `group context`:

- if you select exactly one text node
- and that text node sits inside a Canvas group
- markdown file nodes in that same group are added as default context automatically

This is useful when you want a group to act like a small context bucket around one prompt node.

Image behavior works a little differently from markdown:

- if you select only an image file node, OpenAgent starts a thread with the image attached and no synthetic text wrapper
- if you select one text node and it has connected or grouped image file nodes, the text stays the raw prompt and the images are attached separately
- if you want to be certain an image is present on a later turn, either reselect the image node or use a connected follow-up pattern that preserves that image context

For the exact rule and overlap behavior, see [docs/GROUP_CONTEXT.md](./GROUP_CONTEXT.md).

### 4. Review the Result

Use the OpenAgent side panel to inspect:

- active task state
- recent messages
- tool output
- task history

For image-backed tasks, the panel also shows the selected image attachment in the chat flow so you can see what was sent to Codex, even for image-only turns.

The plugin also writes the final answer back into the Canvas so the graph stays current.

### 5. Continue with a Follow-up

Add a new text node connected to the previous result node and run `OpenAgent: New thread from selection` again on the follow-up node.

You can also run `OpenAgent: Create follow-up node` and bind it to a hotkey. The command creates the follow-up text node and links it to the selected OpenAgent source or result node for you.

OpenAgent will try to reuse the same daemon task and Codex thread while changing the active source node for result sync.

## Files OpenAgent Writes

### In your Obsidian vault

- `.obsidian/plugins/openagent/data.json`
- `Workspaces/<workspace>/workspace.json`
- `Workspaces/<workspace>/Main.canvas`
- updated `.canvas` files with `openagent` metadata on result nodes and edges

### In your home directory

- `~/.openagent/daemon-config.json`
- `~/.openagent/daemon-state.json`
- `~/.openagent/daemon.log`

## Troubleshooting

### The plugin loads but nothing happens

- Make sure `Codex.app` is installed in `/Applications`.
- Make sure the daemon is running, or use `OpenAgent: Start daemon`.
- Check `~/.openagent/daemon.log`.

### OpenAgent says it needs a working directory

- Open the correct workspace for the repo first.
- Re-run `OpenAgent: Choose workspace` if the workspace points at the wrong path.

### Canvas changes do not show up in Obsidian while developing

- Read [docs/OBSIDIAN_PLUGIN_DEV.md](./OBSIDIAN_PLUGIN_DEV.md).
- Confirm the vault plugin files are symlinked back to `apps/obsidian-plugin`.
- Re-run `pnpm run link:obsidian-plugin` if needed.

### A follow-up writes to the wrong node

- Make sure you selected the new follow-up source node, not the old result node.
- If you changed follow-up behavior in code, run `pnpm run test:obsidian-follow-up-chain`.

### An image does not show up in the panel

- Make sure the selected Canvas file node points to a supported raster image type such as `png`, `jpg`, `jpeg`, `gif`, or `webp`.
- Reopen the OpenAgent panel after starting the thread if you were already on the task.
- Re-run `pnpm run test:obsidian-image-only-new-thread` if you are verifying the image-only path during development.

## Current Limitations

- macOS only
- desktop only
- requires local Obsidian Desktop and Codex Desktop
- optimized first for the Obsidian Canvas plus local daemon workflow
