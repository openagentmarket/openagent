# Canvas Run Text Sync

## Summary

OpenAgent had a bug where pressing `Run` on an Obsidian Canvas text node could send incomplete text to the thread.

The user-observed root issue was timing:

- the Canvas editor UI could still be settling the latest text edit
- the `.canvas` file on disk could still be stale
- even runtime-first selection resolution was not sufficient on its own

The fix that currently works in practice is:

- capture live node text first
- blur and best-effort flush pending Canvas edits
- wait `250ms`
- then resolve the selection and send the task to the thread

Code reference:

- [apps/obsidian-plugin/main.js](/Users/applefather/Documents/GitHub/openagent/apps/obsidian-plugin/main.js:1727)

## What Was Tried

### 1. Disk-first selection resolution

Original behavior depended heavily on reading the saved `.canvas` file and parsing selected nodes from disk.

This was not reliable when the user pressed `Run` immediately after typing because Canvas autosave is asynchronous.

### 2. Runtime-first selection resolution

We changed selection resolution to prefer runtime Canvas data and merge live DOM/editor text over it.

That improved the architecture and reduced reliance on stale `.canvas` data, but it still did not fully fix the issue in the real user flow.

Why it was not enough:

- the Canvas runtime/editor state still appears to need a short settle window after blur/save
- the timing issue is not only about disk persistence

### 3. Best-effort blur/save only

We already had logic to:

- blur the active Canvas editor
- call `requestSave` / `save` best-effort

That also was not sufficient by itself.

## What Actually Worked

Adding a short post-flush delay of `250ms` in the `Run` path fixed the issue in practice.

Current sequence in `resolveActiveSelection()`:

1. read selected node ids
2. capture live selected node data from runtime/DOM
3. flush pending Canvas edits
4. wait `250ms`
5. resolve selection
6. create/run the task

This means the `250ms` delay is currently a required synchronization step, not just a nice-to-have debounce.

## Current Recommendation

Treat the `250ms` delay as the known-good behavior for now.

Do not remove it unless there is a stronger signal from the actual Canvas runtime that the node text has fully settled and is ready to send.

## Future Improvements

### 1. Replace the fixed timeout with a real settle signal

Best future direction:

- detect when Canvas editing has actually committed
- or detect when node text stops changing across a short polling window
- or hook a more authoritative Obsidian/Canvas runtime event if one becomes available

### 2. Scope the delay to active text editing only

Right now the timeout is always applied in the active selection run path.

A future optimization could apply it only when:

- the selected source is a text node
- and the Canvas editor was actively being edited just before `Run`

### 3. Add a real regression smoke test

Current headless smoke tests cover selection and prompt assembly, but they do not reproduce the exact interactive timing issue from Obsidian Canvas editing.

Useful future test:

- create/edit a text node in a live Obsidian session
- trigger `Run` immediately after editing
- assert that the full final text reaches the created thread/task

### 4. Revisit the runtime-first helpers later

Runtime-first selection resolution is still a good architectural direction, even though it was not the full fix for this bug.

Those helpers may still pay off for:

- reducing `.canvas` staleness issues
- supporting open-canvas resolution more robustly
- improving group/file context lookup while a canvas is open

But for this specific bug, the user-validated fix is the `250ms` settle delay.

## Bottom Line

For this issue:

- `250ms` timeout works
- runtime-first by itself did not fully work
- blur/save by itself did not fully work

Keep the timeout until we have a more authoritative Canvas-ready signal.
