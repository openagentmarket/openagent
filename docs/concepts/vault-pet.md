---
title: Vault Pet
---

# Vault Pet

Vault Pet is the small animated octopus that lives inside the Obsidian app while
the OpenAgent plugin is enabled.

The current pet is named **Muc Muc**. It is intentionally lightweight: a playful
HTML/CSS/JavaScript overlay that makes the vault feel a little more alive without
changing the core OpenAgent task workflow.

## What It Is

Muc Muc is rendered by the Obsidian plugin as a fixed DOM overlay attached to
the Obsidian window.

It is not:

- a desktop-wide always-on-top window
- a separate native app
- a WebGL scene
- a bitmap image
- a full replacement for the OpenAgent task panel

It is:

- HTML elements created by `apps/obsidian-plugin/main.js`
- CSS drawing and animation from `apps/obsidian-plugin/styles.css`
- plugin state saved through Obsidian `saveData`
- Obsidian vault/workspace event listeners that trigger mood changes

## What It Can Do Now

Muc Muc can:

- float above the Obsidian workspace
- stay inside the Obsidian app window
- be dragged to a new screen position
- remember its position after plugin reloads
- blink, bob, wiggle tentacles, swim slightly, and jump when excited
- show short speech bubbles
- react when the vault changes:
  - file created
  - file modified
  - file deleted
  - file renamed
- react when the active Obsidian pane changes
- fly to the selected text in the active Markdown pane
- open a small selection chat box after being summoned
- prefill that chat box with the selected text
- show the active file path and chosen working directory in the chat box
- start a new OpenAgent/Codex thread from that selected text
- be toggled from OpenAgent settings
- be reset to its default position from OpenAgent settings
- be controlled from the command palette:
  - `OpenAgent: Toggle vault octopus`
  - `OpenAgent: Pet vault octopus`
  - `OpenAgent: Summon vault octopus to selection`

Clicking Muc Muc currently pets it. Petting makes it jump and say a short
personality line.

The default summon hotkey is `Ctrl+R`. If this conflicts with another Obsidian
or system shortcut, change the command hotkey in Obsidian's hotkey settings.

## What It Cannot Do Yet

Muc Muc does not currently:

- understand selected text inside Obsidian Canvas nodes
- use a selected Canvas text node as summon chat context
- continue the latest pet-launched thread from the mini chat
- render full task history inside the mini chat
- answer locally without creating a new OpenAgent thread
- read unrelated note contents as context
- write messages into notes
- sync with other users
- move outside the Obsidian window
- render as a native desktop overlay

Canvas text support is a product direction, not current behavior.

## How It Works

The plugin creates an `OpenAgentVaultPet` instance during `onload` when the
`enableVaultPet` setting is true.

The pet class owns:

- the root overlay element
- the speech bubble element
- pointer drag state
- idle timers
- temporary message timers
- delayed position persistence

Position is stored in `uiState.vaultPetState` and persisted through the plugin's
normal `persistPluginState` path.

The pet listens to activity indirectly through the main plugin lifecycle. The
plugin already subscribes to Obsidian vault and workspace events, and forwards
interesting activity to the pet:

- `handleVaultPetActivity("create", file)`
- `handleVaultPetActivity("modify", file)`
- `handleVaultPetActivity("delete", file)`
- `handleVaultPetActivity("rename", file)`
- `handleVaultPetWorkspaceChange()`

The pet ignores very rapid repeated activity with a short cooldown so that
normal editor saves do not spam the screen.

When summoned to text, the plugin first tries the browser's native selection
rectangle. If that is unavailable, it falls back to the visible CodeMirror
selection rectangles in the active pane. Muc Muc lands beside the selected text
instead of directly covering it.

The current summon flow is Markdown-editor-first. It expects the active pane to
have a real text selection in a Markdown file or a CodeMirror selection
rectangle. Selecting a Canvas node, or selecting text while editing a Canvas text
node, is not resolved into chat context yet.

The selection chat uses a synthetic OpenAgent selection context. For Markdown
files, that context contains:

- the vault-relative file path
- the absolute file path when available
- the selected text
- a generated selection id
- the default working directory

Sending the chat always creates a new OpenAgent thread. It does not write the
assistant result back into the Markdown file; the result appears in the normal
OpenAgent task panel and task stream.

The thread is persisted in the normal local daemon task store. The OpenAgent
panel makes the new thread active after sending. Conversation lists may still be
filtered by the current Canvas or workspace context, so the new pet-launched
thread is not guaranteed to appear in every scoped list.

## Settings

The OpenAgent settings tab includes a `Vault pet` section.

Available controls:

- `Muc Muc the octopus`: enable or disable the pet
- `Pet`: manually pet it
- `Reset spot`: move it back to the default corner

The setting defaults to enabled for local experiments.

## Good Next Steps

The next version of mini chat can become more conversational:

1. Keep recent Muc Muc chats visible near the pet.
2. Let the pet answer locally for tiny personality replies.
3. Escalate to OpenAgent/Codex only when the user asks for real work.
4. Add a follow-up mode for continuing the latest pet-launched thread.

Suggested interaction model:

- `Ctrl+R`: summon to selected text and open mini chat
- small heart button: pet
- escape: close chat
- command palette: show/hide/reset

The clean architecture is:

- pet overlay handles presence, mood, and lightweight interaction
- OpenAgent panel handles durable tasks and serious work
- daemon/Codex is only called when the user explicitly asks for an agent action

## Future Capabilities

Possible future versions could add:

- Canvas text-node summon support
- an all-conversations inbox for pet-launched threads
- chat mode with a tiny personality
- current-note awareness
- daily note check-ins
- vault activity streaks
- mood based on writing rhythm
- memory stored as Markdown in the vault
- optional OpenAgent task creation from pet chat
- canvas-aware movement or reactions
- sprite/image skins
- sound effects with a setting
- companion desktop overlay via a helper app

The desktop overlay version would require a separate local helper app or daemon,
because an Obsidian plugin can reliably draw inside the Obsidian window but not
across the whole operating system desktop.
