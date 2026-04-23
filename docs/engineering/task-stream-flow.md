---
sidebar_position: 4
---

# Obsidian Task Stream Flow

This note explains the current task-update model for the Obsidian plugin after removing automatic running-task polling.

## Summary

OpenAgent no longer polls running tasks every `1.5s`.

Instead:

1. the daemon remains the source of truth for task state
2. the plugin opens a server-sent events stream for the current active task
3. streamed task updates are merged into plugin state
4. when the task reaches a completed idle state with a fresh assistant message, the plugin syncs the result node back into the canvas

If the stream drops unexpectedly, the plugin now recovers by refreshing the task once and reconnecting the stream.

## Why We Removed Polling

The old running-task poll kept non-active threads fresh, but it also had downsides:

- unnecessary background work every `1.5s`
- panel rerenders while hovering thread rows
- UI updates that felt noisy and harder to reason about

The current model favors:

- realtime updates for the active conversation
- no interval-based task polling in the background
- event-driven canvas selection tracking
- explicit manual refresh for non-active threads

## Canonical Data Flow

### 1. The daemon owns task state

The daemon persists task state in `~/.openagent/daemon-state.json`.

It is responsible for:

- task status such as `starting`, `running`, `idle`, and `error`
- task messages
- task `threadId`
- task `canvasBinding`

The plugin cache is only a local view of that daemon state.

### 2. Runtime notifications become task updates

When Codex Desktop emits runtime notifications, the daemon patches the task and publishes `task.updated` events.

Relevant daemon paths:

- `apps/openagent-daemon/src/server.js`
- `publishTask()`
- `handleRuntimeNotification()`
- `GET /tasks/:taskId/stream`

In practice this means events such as:

- `turn/started`
- `item/agentMessage/delta`
- `turn/completed`

all become task updates that the plugin can consume.

### 3. The plugin subscribes only to the active task

The plugin does not stream every task.

It subscribes only to `uiState.activeTaskId`.

That happens when:

- a task is explicitly opened in the panel
- selection-to-task sync chooses a task as active
- a new thread is created and activated

This is an intentional tradeoff:

- active conversation stays live
- non-active threads do not auto-refresh in the background

### 4. Streamed updates are merged into plugin state

When the daemon pushes `task.updated`, the plugin:

1. parses the SSE frame
2. calls `mergeTask()`
3. refreshes the panel view
4. runs task-to-canvas sync logic such as result-node updates

The important plugin effect is that `mergeTask()` is the central path for keeping UI state and canvas sync behavior aligned.

### 5. Result node sync happens after completion

When the merged task has:

- a current assistant message
- a valid canvas source node
- `status === "idle"`
- no active turn in flight

the plugin may write or update the linked result node in the canvas.

This is how assistant output becomes a graph node again.

## Stream Drop Recovery

Removing poll exposed a weaker failure mode:

- if the active-task stream silently dropped
- the plugin could stop receiving the final `idle` update
- the task would be completed in the daemon
- but the panel and result-node sync path might never see that final state

The plugin now handles this more defensively.

When the active stream ends or errors:

1. the plugin treats it as a stream close
2. it immediately calls `refreshTask(taskId)` once
3. this pulls the latest canonical task state from the daemon
4. if the same task is still active, the plugin reconnects the stream after `1.5s`

This means stream recovery is now:

- event-driven
- bounded
- specific to the active task

without bringing back interval polling.

## What Still Does Not Auto-Refresh

This is important.

The current model does **not** restore the old behavior for non-active threads.

That means:

- thread lists do not automatically refresh all running tasks in the background
- a non-active conversation can finish without its row updating immediately
- the `Refresh` button remains the manual reconciliation path for thread-list state

This is expected with the current architecture.

## Mental Model

Use this short version:

- daemon owns truth
- active task gets a live stream
- stream updates call `mergeTask()`
- `mergeTask()` drives panel refresh plus canvas sync
- if the stream drops, the plugin refreshes once and reconnects
- non-active threads are manual-refresh only

## Related Files

- [apps/obsidian-plugin/main.js](https://github.com/openagentmarket/openagent/blob/main/apps/obsidian-plugin/main.js)
- [apps/openagent-daemon/src/server.js](https://github.com/openagentmarket/openagent/blob/main/apps/openagent-daemon/src/server.js)
- [Architecture](./architecture.md)
- [Plugin Development](./plugin-development.md)
