# OpenAgent Project Map

This is the fastest way to understand what this repository is, which folders matter, and how the pieces fit together in day-to-day work.

Read this before diving into source if you are new to the repo.

## One-Sentence Summary

OpenAgent turns an Obsidian Canvas selection into a local Codex task, streams the run through a local daemon, and writes the answer back into the canvas as graph content.

## What We Are Building Here

The primary product in this repo is a local-first workflow for repo work:

1. Obsidian Canvas is the planning and context surface.
2. OpenAgent reads selected nodes from that canvas.
3. A local daemon turns that selection into a durable task and runs Codex Desktop against a real repo on disk.
4. The plugin keeps task state visible in Obsidian and syncs the final assistant output back into the graph.

This repo is optimized for:

- macOS
- Obsidian Desktop
- Codex Desktop
- local repo workflows where the canvas is the main working surface

## The Real Product Surface

The product is mostly implemented in three places:

### `apps/obsidian-plugin`

The Obsidian plugin.

It is responsible for:

- reading the active canvas and selected nodes
- resolving text nodes and markdown file nodes into prompt context
- letting the user choose a repo workspace inside the vault
- launching or reconnecting to the local daemon
- rendering the OpenAgent side panel
- syncing running/completed node colors
- writing assistant result nodes and edges back into `.canvas` files

Important note: the current plugin implementation is still concentrated in one large file, [`apps/obsidian-plugin/main.js`](https://github.com/openagentmarket/openagent/blob/main/apps/obsidian-plugin/main.js).

### `apps/openagent-daemon`

The local HTTP daemon.

It is responsible for:

- creating and reusing tasks from canvas selections
- persisting task state in `~/.openagent/daemon-state.json`
- validating that Codex Desktop is available
- starting or resuming Codex threads
- sending turns to the Codex runtime
- collecting runtime notifications into task messages
- exposing task routes and server-sent event streams to the plugin

Main entry point: [`apps/openagent-daemon/src/server.js`](https://github.com/openagentmarket/openagent/blob/main/apps/openagent-daemon/src/server.js)

### `packages/core`

Shared domain helpers used by both the plugin and daemon.

It holds the common rules for:

- normalizing canvas selections
- building prompts from selected canvas context
- generating stable task ids and selection keys
- normalizing `canvasBinding`
- creating the canonical persisted task shape

Main entry point: [`packages/core/src/index.js`](https://github.com/openagentmarket/openagent/blob/main/packages/core/src/index.js)

## How The Main Flow Works

The normal product flow is:

1. A workspace in the Obsidian vault points to a real repo on disk.
2. The user opens a canvas in that workspace.
3. The user selects one or more nodes.
4. The plugin resolves those nodes into a normalized `selectionContext`.
5. The plugin asks the daemon to create or reuse a task for that selection and repo.
6. The daemon starts or resumes a Codex thread.
7. Runtime notifications become task messages.
8. The plugin updates its panel UI and writes the latest assistant answer back into the canvas as a result node.

For follow-ups, the plugin can treat a new text node connected to an older result node as a continuation of the same task/thread, while moving the active canvas source node forward.

The repo binding comes from the workspace folder, not from a `.canvas` file alone. In practice, any canvas under the same workspace folder resolves to the same repo because the plugin maps the canvas path back to that workspace's `workspace.json`.

## Repository Map

These are the tracked folders that matter most:

- `apps/obsidian-plugin`
  Production Obsidian plugin source and assets.
- `apps/openagent-daemon`
  Production local daemon source.
- `packages/core`
  Shared task/canvas helpers used by both sides.
- `scripts`
  Setup, linking, sync, CLI, and smoke-test automation.
- `fixtures/obsidian-smoke`
  Checked-in fixture vault content used by headless and plugin smoke tests.
- `skills/openagent-canvas-bootstrap`
  Codex bootstrap skill for wiring a repo into OpenAgent quickly.
- `docs`
  User, architecture, dev, and maintenance documentation.
- `.github/workflows`
  CI that currently runs repo checks.

Important tracked single files:

- [`README.md`](https://github.com/openagentmarket/openagent/blob/main/README.md): product-level entry point
- [`docs/USER_GUIDE.md`](./USER_GUIDE.md): user workflow inside Obsidian
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md): plugin/daemon/core architecture
- [`docs/SAFE_SKILL_SANDBOX_MVP.md`](./SAFE_SKILL_SANDBOX_MVP.md): cloud-first product spec for safely testing third-party AI skills
- [`docs/OBSIDIAN_PLUGIN_DEV.md`](./OBSIDIAN_PLUGIN_DEV.md): local plugin development workflow
- [`docs/OBSIDIAN_PLUGIN_RELEASE.md`](./OBSIDIAN_PLUGIN_RELEASE.md): plugin packaging and GitHub release workflow
- [`package.json`](https://github.com/openagentmarket/openagent/blob/main/package.json): workspace scripts and top-level commands

## What Is Source Code vs. Local Working State

This repo can look bigger than it really is because it is often used inside a live Obsidian/Codex working environment.

Source of truth in git:

- `apps/`
- `packages/`
- `scripts/`
- `fixtures/`
- `docs/`
- `skills/`

Local or generated state that should not be mistaken for product source:

- `node_modules/`
- `.openagent/` in the user home directory
- vault runtime files under `.obsidian/` except the tracked `.hotreload` marker
- workspace output under `Workspaces/`
- smoke output under `OpenAgent Smoke/`

The top-level repo may also contain personal vault folders or working directories on one machine. Those are environment artifacts unless they are actually tracked by git.

## Scripts And What They Are For

Top-level scripts defined in [`package.json`](https://github.com/openagentmarket/openagent/blob/main/package.json):

- `pnpm run check`
  Runs syntax plus hygiene checks.
- `pnpm run check:syntax`
  Parses all `.js` and `.mjs` files with Node's syntax checker.
- `pnpm run check:hygiene`
  Blocks common secrets and machine-specific path leaks from being committed.
- `pnpm run dev:daemon`
  Starts the local daemon.
- `pnpm run link:obsidian-plugin`
  Symlinks plugin files from the repo into the current Obsidian vault.
- `pnpm run sync:obsidian-plugin`
  Copies plugin files into the vault instead of symlinking.
- `pnpm run test:obsidian-smoke`
  General plugin smoke path.
- `pnpm run test:obsidian-markdown-new-thread`
  Verifies markdown-file-only new-thread behavior.
- `pnpm run test:obsidian-follow-up-chain`
  Verifies task/thread reuse and follow-up result sync.
- `pnpm run test:obsidian-node-colors`
  Verifies running/completed canvas color behavior.
- `pnpm run test:obsidian-ui-smoke`
  Exercises the command-palette/UI path.

There is also a small CLI at [`scripts/openagent-cli.mjs`](https://github.com/openagentmarket/openagent/blob/main/scripts/openagent-cli.mjs) that helps with setup and repo bootstrap.

## Key Contracts Worth Knowing

These rules show up across the codebase and explain a lot of the implementation choices:

### Task identity is selection-based

The daemon builds a stable task identity from:

- `canvasPath`
- sorted selected `nodeIds`
- repo working directory

That means the same selection in the same repo can reuse the same task unless the caller forces a fresh task.

### The daemon owns canonical task state

The daemon is the source of truth for:

- task status
- thread id
- turn id
- task messages
- runtime config
- canonical `canvasBinding`

Plugin state in `data.json` is a local UI cache, not the canonical binding owner.

### `canvasBinding` is the glue between task state and graph state

The current binding keeps track of:

- which canvas the task belongs to
- which original nodes define the root of the conversation
- which node is the active follow-up source
- which result node belongs to which source node

That is what makes follow-up chains and safe result sync possible.

### Result sync is timestamp-aware

The plugin checks `activeSourceUpdatedAt` so an older assistant message does not get written onto a newer follow-up source node.

### The repo is local-first

The main workflow assumes local apps, local files, and a local daemon. This is not a hosted SaaS architecture.

## Current Shape Of The Code

Today the codebase is functional and reasonably understandable, but still early in a few ways:

- the plugin is feature-rich but still centralized in one large `main.js`
- the daemon is small and direct, with task state persisted to local JSON
- the shared core package is intentionally thin and focused on normalization and identity
- CI currently verifies repository checks, not the full Obsidian integration stack

There is also one small legacy-looking signal in the repo: the root `package.json` description still mentions XMTP, and the daemon still exposes an XMTP channel bind route. That is not the main documented product flow today.

## Recommended Reading Order

If you want to understand the repo quickly, use this order:

1. [`README.md`](https://github.com/openagentmarket/openagent/blob/main/README.md)
2. this document
3. [`docs/USER_GUIDE.md`](./USER_GUIDE.md)
4. [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
5. [`docs/OBSIDIAN_PLUGIN_DEV.md`](./OBSIDIAN_PLUGIN_DEV.md)
6. [`apps/obsidian-plugin/main.js`](https://github.com/openagentmarket/openagent/blob/main/apps/obsidian-plugin/main.js)
7. [`apps/openagent-daemon/src/server.js`](https://github.com/openagentmarket/openagent/blob/main/apps/openagent-daemon/src/server.js)
8. [`packages/core/src/index.js`](https://github.com/openagentmarket/openagent/blob/main/packages/core/src/index.js)

## If You Need To Change Something

A practical rule of thumb:

- changing selection parsing or prompt building usually touches plugin resolver logic and `packages/core`
- changing task identity, task persistence, or runtime execution usually touches the daemon and `packages/core`
- changing canvas result sync or node colors usually touches plugin write-back logic and often needs a smoke test
- changing bootstrap/setup usually touches `scripts/` and sometimes the bootstrap skill

When behavior affects real Obsidian flows, prefer running the smallest relevant smoke test instead of stopping at syntax-only checks.
