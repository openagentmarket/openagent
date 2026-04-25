---
sidebar_position: 4
---

# Canvas Branching

Canvas branching is OpenAgent's rule for trying an alternate direction from an existing Canvas conversation without losing the original thread.

## Short Version

Use a result node as the branch point.

- the assistant result node is the checkpoint
- the new text node is the branch prompt
- running the branch prompt asks for confirmation before forking
- the fork gets its own OpenAgent task and Codex thread

This keeps the Canvas graph readable: assistant nodes are stable answers, user nodes are requests, and branch edges show where an alternate path begins.

Only assistant result nodes expose the fork action. Source/user request nodes can
continue the same thread through follow-ups, but they are not branch checkpoints.

## Intended UX

The normal shape is:

1. Start a thread from a user request node.
2. Let OpenAgent write an assistant result node.
3. Select that result node.
4. Click the fork icon in the Canvas node menu.
5. OpenAgent creates an empty fork request node connected from that result.
6. Write the alternate prompt in the fork request node.
7. Run `OpenAgent: New thread from selection` on the fork request node.
8. Confirm `Fork from here?`.

After confirmation, OpenAgent forks the source Codex thread, removes later turns from the fork when needed, and runs the branch prompt on the new thread.

## Why Branch From Result Nodes

Result nodes are the clearest checkpoints because they represent a completed assistant state.

Branching from a result node answers a concrete question:

> What if I continued from this answer instead of the path I actually took later?

That is easier to understand than branching directly from a user request node, because a user request node can be either:

- the original prompt before any answer exists
- an active follow-up source
- a draft prompt that has not run yet

OpenAgent requires selecting the result node for the explicit fork action. This
keeps the fork icon and any hotkey assigned to `OpenAgent: Create fork node`
aligned with the same rule: result nodes are checkpoints, text nodes are prompts.

## Follow-Up vs Fork

A follow-up continues the same task/thread.

Use follow-up when you want:

- clarification
- refinement
- the next step in the same direction

A fork creates a separate task/thread.

Use fork when you want:

- a competing answer
- an alternate implementation direction
- a branch from an older result after the main conversation already moved on
- a safe experiment you may discard

## What Happens Under The Hood

When OpenAgent forks a Canvas branch:

- the plugin identifies the upstream OpenAgent result metadata
- the daemon creates a fresh task for the branch node
- the daemon calls Codex `thread/fork` from the source thread
- if the branch starts from an older result, the daemon rolls back later turns inside the fork
- the branch result is written back as a new assistant result node

The original task/thread is left untouched.

## Related Docs

- [User Guide](../getting-started/user-guide.md)
- [Obsidian Canvas Reference](./obsidian-canvas.md)
- [Architecture](../engineering/architecture.md)
