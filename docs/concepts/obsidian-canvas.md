---
sidebar_position: 2
---

# Obsidian Canvas Reference

This is a quick English reference for the parts of Obsidian Canvas that matter most when working with OpenAgent.

Canvas is an Obsidian core plugin for visual note-taking. It gives you an infinite 2D workspace where you can place cards, connect them, group them, and navigate the graph spatially.

OpenAgent builds on top of that workflow, so it helps to know the default Canvas interactions before using Canvas selections as Codex task context.

## What Canvas Supports

Canvas can work with:

- text cards
- note cards from your vault
- media cards from your vault
- embedded web pages
- folder drops that expand into multiple files
- directional connections with labels
- groups for visually clustering related cards

Canvas files are stored as `.canvas` files using the open `JSON Canvas` format.

## Default Canvas Shortcuts And Interactions

These are the default interactions documented by Obsidian.

### Navigation

- `Shift+1`: Zoom to fit
- `Shift+2`: Zoom to selection
- `Space` + drag: Pan the canvas
- Middle-mouse drag: Pan the canvas
- Mouse wheel: Pan vertically
- `Shift` + mouse wheel: Pan horizontally
- `Space` + mouse wheel: Zoom
- `Ctrl` + mouse wheel, or `Cmd` + mouse wheel on macOS: Zoom

### Creating And Editing Cards

- Double-click empty canvas: Create a text card
- Double-click a text card or note card: Edit the card
- `Esc`: Stop editing a card
- `Backspace`, or `Delete` on macOS: Delete the selected card or connection

### Selecting, Moving, And Resizing

- `Shift` + click: Add or remove cards from the current selection
- `Ctrl+A`, or `Cmd+A` on macOS: Select all cards
- `Alt` + drag, or `Option` + drag on macOS: Duplicate the current selection
- `Shift` + drag: Move only in one direction
- `Space` while moving: Temporarily disable snapping
- `Space` while resizing: Temporarily disable snapping
- `Shift` while resizing: Keep aspect ratio

### Connections And Labels

- Drag from a card edge handle to another card: Create a connection
- Double-click a connection: Add or edit a label
- `Esc` or click the canvas after typing a connection label: Finish editing the label

## Common Canvas Actions

### Add cards

You can add content by:

- double-clicking the canvas to create a text card
- using the canvas toolbar buttons
- right-clicking the canvas
- dragging files from the Obsidian file explorer
- dragging URLs from a browser
- dragging folders from the file explorer to place multiple files at once

### Convert and swap cards

- Convert a text card into a real note file with `Convert to file...`
- Swap a note or media card with another file of the same type using `Swap file`

### Organize relationships

- connect cards with directional lines
- add labels to describe the relationship
- change the color of cards or connections
- create empty groups or group selected cards
- rename a group by double-clicking its title and pressing `Enter`

### Open linked web content

For a web page card, `Cmd`-click on macOS or `Ctrl`-click on other platforms to open the page in your browser from the card label.

## Hotkeys In Obsidian

Canvas has a small set of default shortcuts, but many Canvas-related actions are still best discovered through Obsidian commands.

To see or customize Canvas hotkeys:

1. Open `Settings -> Hotkeys`
2. Search for `Canvas:`
3. Assign the shortcuts you want

You can also open the Command Palette and search for `Canvas:` to see available commands and whether they already have a hotkey assigned.

## Why This Matters For OpenAgent

OpenAgent relies on Canvas selection as task context. In practice, the most useful Canvas habits are:

- selecting the exact cards you want to send as context
- grouping related notes before starting a thread
- connecting follow-up requests to prior result nodes
- using zoom and pan shortcuts to navigate larger working canvases quickly

OpenAgent also treats some groups as `group context` during new-thread creation:

- if you start a new thread from one text node
- markdown file nodes in the same Canvas group can be included automatically as default context
- this is separate from edge-based follow-up behavior

## Sources

- [Obsidian Canvas help](https://obsidian.md/help/plugins/canvas)
- [Obsidian Hotkeys help](https://obsidian.md/help/hotkeys)
---
sidebar_position: 2
---
