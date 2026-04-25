---
sidebar_position: 1
---

# OpenAgent Architecture

This doc explains how the Obsidian plugin, the local daemon, and the shared task model fit together.

## High-Level Shape

OpenAgent is currently a local-first monorepo with three main layers:

- `apps/obsidian-plugin`
  The Obsidian plugin that reads Canvas selections, renders UI, and writes results back into `.canvas` files.
- `apps/openagent-daemon`
  The local HTTP daemon that owns durable task state and talks to Codex Desktop.
- `packages/core`
  Shared task, selection, prompt, and Canvas-binding helpers used by the daemon and plugin.

## Main User Flow

1. The user opens a repo workspace inside an Obsidian vault.
2. The plugin resolves the selected Canvas nodes into a structured `selectionContext`.
3. The plugin calls the daemon to create or reuse a task from that selection.
4. The daemon normalizes the selection, computes a stable selection key, and creates or reuses a task record.
5. The plugin asks the daemon to run the task.
6. The daemon starts or resumes a Codex Desktop thread and streams events back into task state.
7. The plugin refreshes its panel UI and writes assistant results back into the Canvas as result nodes.

## Component Responsibilities

### Obsidian plugin

The plugin is responsible for:

- resolving Obsidian Canvas selections into prompt context
- showing the task panel and settings UI
- auto-starting the daemon when configured
- subscribing to task updates
- syncing assistant results and node colors back into `.canvas` files
- persisting local UI fallback state in plugin `data.json`

The current plugin implementation lives mostly in one file:

- `apps/obsidian-plugin/main.js`

Key classes in that file:

- `WorkspacePickerModal`
  Chooses or creates repo workspaces inside the vault.
- `OpenAgentDaemonLauncher`
  Starts the local daemon when the plugin needs it.
- `OpenAgentApiClient`
  Talks to the daemon over local HTTP and task event streams.
- `CanvasSelectionResolver`
  Converts selected Canvas nodes into structured context.
- `OpenAgentView`
  Renders the side panel, task history, message stream, and composer.
- `OpenAgentSettingTab`
  Exposes plugin settings inside Obsidian.
- `OpenAgentPlugin`
  Wires lifecycle, commands, canvas selection hooks, and file event handling together.

### Daemon

The daemon is the source of truth for runtime task state.

It is responsible for:

- validating Codex Desktop runtime availability
- storing task state in `~/.openagent/daemon-state.json`
- exposing local HTTP routes for task creation, execution, interruption, and streaming
- creating or resuming Codex threads
- appending user, assistant, tool, and status messages into task history
- preserving canonical `canvasBinding` state used for follow-up recovery

The main daemon entry point is:

- `apps/openagent-daemon/src/server.js`

Important routes:

- `GET /health`
- `GET /tasks`
- `GET /tasks/:taskId`
- `GET /tasks/:taskId/stream`
- `POST /tasks/from-canvas-selection`
- `POST /tasks/:taskId/run`
- `POST /tasks/:taskId/fork`
- `POST /tasks/:taskId/messages`
- `PATCH /tasks/:taskId/canvas-binding`
- `POST /tasks/:taskId/interrupt`

### Shared core

`packages/core/src/index.js` holds the shared domain helpers for:

- normalizing `selectionContext`
- building prompt text from Canvas context
- creating stable task ids and fresh task ids
- normalizing `canvasBinding`
- building the persisted task object shape

This shared package is what keeps the daemon and plugin aligned on task identity and Canvas sync behavior.

## State Ownership

OpenAgent has three important state layers:

### 1. Daemon task state

Canonical owner:

- task identity
- working directory
- thread id
- current turn id
- task messages
- runtime config
- canonical `canvasBinding`

Stored in:

- `~/.openagent/daemon-state.json`

### 2. Canvas files

Projection layer:

- assistant result nodes
- result edges
- `openagent` metadata attached to written Canvas objects

Stored in:

- workspace `.canvas` files inside the Obsidian vault

### 3. Plugin local UI state

Fallback and reload-resilience layer:

- active task selection
- current panel tab
- draft composer text
- local sync caches used by the plugin

Stored in:

- `.obsidian/plugins/openagent/data.json`

Important rule:

The plugin cache is not the source of truth for task/thread binding. The daemon task record is.

## Task Identity and Reuse

The daemon builds a stable `selectionKey` from the normalized selection:

- `canvasPath`
- sorted selected `nodeIds`

That key is combined with the working directory to derive a stable task id.

Implications:

- same selection + same repo can reuse the same task
- same selection + different repo becomes a different task
- `forceNewTask` creates a fresh task id even for the same selection

## Canvas Binding Contract

The `canvasBinding` object is what keeps thread state attached to the graph.

Current fields include:

- `canvasPath`
- `rootNodeIds`
- `activeSourceNodeId`
- `activeSourceUpdatedAt`
- `resultNodesBySourceNodeId`

This matters most for follow-ups:

- the root selection can stay stable across a chain
- the active source node can move to a newer follow-up node
- result sync should only attach assistant output to the correct active source
- a branch from an older result can fork the source Codex thread, roll back later
  turns in the fork, and continue from that Canvas point as a separate task

The UX contract is that assistant result nodes are branch checkpoints and text
nodes are branch prompts. The fork icon and `OpenAgent: Create fork node`
command require selecting a result node, then create a text node connected from
that checkpoint. The actual Codex fork happens only when that prompt node is run
and the user confirms the fork.

## Runtime and Streaming Flow

When the plugin runs a task:

1. it sends the normalized prompt or follow-up message to the daemon
2. the daemon validates the working directory and runtime config
3. the daemon starts Codex Desktop runtime if needed
4. the daemon creates or resumes a thread
5. the daemon sends a turn
6. Codex runtime notifications are converted into task message updates
7. task updates are published over the task stream
8. the plugin refreshes UI and Canvas sync from those updates

## Files and Persistence

### Home directory

- `~/.openagent/daemon-config.json`
  Local daemon address and auth token
- `~/.openagent/daemon-state.json`
  Persisted daemon task and channel state
- `~/.openagent/daemon.log`
  Daemon logs

### Vault

- `.obsidian/plugins/openagent/data.json`
  Plugin settings and local UI state
- `Workspaces/<name>/workspace.json`
  Repo path and default canvas
- `Workspaces/<name>/Main.canvas`
  Workspace entry canvas

## Current Code Map

The repo's documentation now separates user flow from architecture because the plugin source is still concentrated in one large file.

That is workable for early iteration, but it means:

- readers need a map before touching code
- behavior changes should update docs at the same time
- future refactors will likely split plugin responsibilities into smaller modules

## Design Constraints

- local-first by default
- desktop-only plugin workflow
- macOS-first runtime assumptions
- safe default sandbox mode for repo work
- Canvas remains the primary UI surface, not just a visualization target
