---
sidebar_position: 2
---

# Obsidian Plugin Dev

This is the working playbook for developing and testing the Obsidian plugin in this repo.

Read these first when you need broader context:

- [User Guide](../getting-started/user-guide.md) for the user-facing workflow
- [Architecture](./architecture.md) for the plugin, daemon, and task model
- [Plugin Release](./plugin-release.md) for versioning and GitHub release steps

## Source of truth

Edit plugin code in:

- `apps/obsidian-plugin`

Obsidian runs the plugin from:

- `<your-vault>/.obsidian/plugins/openagent`

In this repo, the vault plugin files can be symlinked back to the repo source for normal development.

## One-time setup

Run this once, or again if the links ever get broken:

```bash
pnpm run link:obsidian-plugin
```

By default, the script uses the currently open Obsidian vault from Obsidian's
local `obsidian.json`. To choose a vault explicitly, pass:

```bash
OPENAGENT_OBSIDIAN_VAULT=/path/to/vault pnpm run link:obsidian-plugin
```

This links these vault plugin files back to the repo:

- `main.js`
- `styles.css`
- `manifest.json`
- `package.json`
- `logo.png`

`data.json` stays in the vault as normal plugin state.

## Normal feature workflow

For most plugin changes, use this loop:

1. Edit files in `apps/obsidian-plugin`.
2. Save the file.
3. Obsidian Hot Reload sees the vault plugin file change.
4. Hot Reload disables and re-enables the plugin.
5. Test the behavior in Obsidian.

Short version: edit in repo, save, let Hot Reload reload, test.

## Close-the-loop workflow

When adding or changing a feature, try to close the loop with all 3 layers:

1. Production code path
   Change the real plugin logic in `apps/obsidian-plugin/main.js`.
2. Real plugin load path
   Make sure Obsidian is using the symlinked plugin in the vault.
3. Automated verification
   Add or run a smoke script that exercises the real Obsidian/plugin/canvas flow.

That is the preferred standard for changes that affect plugin lifecycle, canvas writes, commands, task state, or UI state transitions.

Do not stop at `pnpm run check:syntax` for those changes unless the user explicitly asks for a partial check only.
Default expectation for lifecycle-affecting work is:

1. run syntax
2. run the smallest smoke that covers the changed behavior
3. if the feature changes a full start-to-finish path, run the closest close-the-loop smoke
4. reload Obsidian so manual verification can start immediately

## Canvas/thread sync contract

When a feature touches Canvas sync, treat the state layers like this:

1. the daemon owns the task record, including `task.messages`, `threadId`, and
   per-task `canvasBinding`
2. the plugin projects that state back into `.canvas` files by writing result
   nodes, result edges, and `openagent` metadata onto those Canvas objects
3. plugin `data.json` / `saveData.syncState` is only a local UI fallback and
   cache for reload resilience, not the canonical binding source

Current `canvasBinding` is expected to carry at least:

- `canvasPath`
- `rootNodeIds`
- `activeSourceNodeId`
- `activeSourceUpdatedAt`
- `resultNodesBySourceNodeId`

Follow-up behavior depends on `activeSourceUpdatedAt`. When the active source
switches to a new follow-up node, the plugin must not sync an older assistant
reply onto that new source node. Result-node updates and completed-node
highlighting should only use assistant messages newer than the active-source
timestamp.

If you change this contract, update both the daemon normalization path and the
plugin recovery/write-back path together.

## Canvas result link normalization

Codex often emits Markdown file links with full filesystem targets, such as:

```md
[main.js](/Users/me/projects/example/apps/obsidian-plugin/main.js:7040)
```

Obsidian Canvas text nodes do not treat those as internal vault links. They
resolve internal Markdown links from the vault root, while non-vault files need
external `file://` URLs.

The plugin normalizes assistant-result links when writing the Canvas result node,
not when rendering the side panel. The task message stays unchanged; only the
projected Canvas node text is adapted for Obsidian.

Writeback behavior:

- if the absolute target maps to a file Obsidian has indexed in the vault, write
  the link target as a vault-relative Markdown path
- if the absolute target maps through a symlinked vault file, still write the
  indexed vault-relative path
- if the target is outside the vault, write it as a `file://` URL so Obsidian can
  hand it to the operating system
- if the target includes a Codex-style `:line` suffix, strip that suffix from the
  destination because Obsidian does not open Markdown links by source line number

## Verification ladder

Use the smallest test that gives confidence, then move up only if needed.

### 1. Fast syntax check

```bash
pnpm run check:syntax
```

Use this after every code edit.

### 2. Headless selection/prompt smoke

```bash
node scripts/headless-canvas-smoke.mjs
```

Use this when changing selection parsing or prompt assembly without needing Obsidian itself.

### 3. Plugin smoke via smoke-request

```bash
pnpm run test:obsidian-smoke
```

Use this when you want Obsidian to load the plugin and process a generated smoke request.

### 3b. Markdown-file new-thread smoke

```bash
pnpm run test:obsidian-markdown-new-thread
```

Use this when `New thread` behavior depends on selecting exactly one markdown file node.

This script currently verifies:

1. plugin files are linked into the vault
2. Obsidian restarts cleanly
3. a smoke request runs through the real plugin
4. the markdown file becomes the raw thread context
5. the source node turns yellow while running
6. the source node turns blue after completion
7. a result node is written back into the canvas

### 4. UI command smoke

```bash
pnpm run test:obsidian-ui-smoke
```

Use this when the command palette / canvas interaction itself matters.

### 5. Node color close-the-loop smoke

```bash
pnpm run test:obsidian-node-colors
```

Use this for the canvas node state-color flow.

This script currently verifies:

1. plugin files are linked into the vault
2. Obsidian restarts cleanly
3. a smoke request runs through the real plugin
4. the source node turns yellow while running
5. the source node turns blue after completion
6. a result node is written back into the canvas

### 6. Follow-up chain close-the-loop smoke

```bash
pnpm run test:obsidian-follow-up-chain
```

Use this when changing follow-up behavior, task reuse, result-node replacement,
or Canvas/daemon binding recovery.

This script currently verifies:

1. the initial Canvas selection creates or reuses a daemon task with a matching `canvasBinding`
2. a follow-up node reuses the same task/thread and becomes the active source node
3. the follow-up source does not briefly receive the previous assistant reply before the new reply arrives
4. the follow-up result node is written back with the expected Canvas metadata

### 7. Fork branch close-the-loop smoke

```bash
pnpm run test:obsidian-fork-branch
```

Use this when changing Canvas branch detection or Codex thread forking.

This script currently verifies:

1. a normal follow-up still reuses the existing task/thread
2. a second branch from an older result creates a new task/thread
3. the fork rolls back later turns before running the branch prompt
4. the fork result node is written back with the expected Canvas metadata

## Hot Reload behavior

Hot Reload watches `.obsidian/plugins/...` in the vault, not the repo directly.

It only auto-reloads dev plugins marked with either:

- a `.git` directory, or
- a `.hotreload` file

`openagent` uses `.hotreload`.

Because the vault plugin files are symlinked to the repo, saving repo files changes the watched vault files too.

## Do not duplicate steps

Normal local development should **not** do all of these together:

- edit repo files
- run `pnpm run sync:obsidian-plugin`
- run `pnpm run link:obsidian-plugin`

Pick the right mode:

- Symlink mode:
  Use `pnpm run link:obsidian-plugin` once, then just edit repo files and rely on Hot Reload.
- Copy mode:
  Use `pnpm run sync:obsidian-plugin` only if you intentionally want copied files instead of symlinks.

If you are in symlink mode, `sync:obsidian-plugin` is usually redundant.

## When sync is still useful

```bash
pnpm run sync:obsidian-plugin
```

Use sync only when:

- you intentionally want copied files in the vault instead of symlinks
- you want to recover a manual copied install
- you are debugging something specific about copied plugin files

Like the link command, sync accepts an explicit vault path:

```bash
OPENAGENT_OBSIDIAN_VAULT=/path/to/vault pnpm run sync:obsidian-plugin
```

## Troubleshooting

If a change does not appear:

1. Confirm the file you changed is under `apps/obsidian-plugin`.
2. Confirm the vault plugin file is still a symlink.
3. Wait about a second for Hot Reload debounce.
4. Toggle the `OpenAgent` plugin off/on in Obsidian.
5. Re-run:

```bash
pnpm run link:obsidian-plugin
```

If a feature depends on task completion state, also run the closest smoke test instead of only testing by hand.

## Recommended workflow for future features

When building a new plugin feature, use this checklist:

1. implement the real plugin change
2. run `pnpm run check:syntax`
3. run the smallest relevant smoke test
4. if the feature touches full plugin lifecycle or canvas writes, add or update a smoke script and run it
5. reload Obsidian and verify the same behavior manually if the UI matters

If a new feature introduces a state transition that can regress silently, prefer adding a dedicated smoke script for it.
---
sidebar_position: 2
---
