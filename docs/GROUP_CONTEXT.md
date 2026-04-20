# Group Context

`Group context` is OpenAgent's rule for treating some Obsidian Canvas groups as default markdown context for a new Codex thread.

It is meant to make one prompt node plus a few supporting markdown files feel lightweight and natural on Canvas.

## Short Version

When you start a new thread from exactly one text node:

- OpenAgent finds the smallest Canvas group that contains that text node
- markdown file nodes in that same group are added as default context
- markdown file nodes outside that group are ignored

The selected text node remains the primary user request.

## When It Applies

Group context applies only during `OpenAgent: New thread from selection`.

It does not change follow-up behavior.

If the selected node is detected as a follow-up to an existing thread through Canvas edges, OpenAgent keeps the follow-up behavior and does not reinterpret that action as a new thread with fresh group context.

## Supported Shape

The intended shape is:

- one selected text node
- one or more markdown file nodes in the same group

You do not need to select the markdown file nodes directly for them to be included.

## Membership Rule

Canvas groups do not carry explicit child membership in the file format.

OpenAgent therefore infers group membership from geometry:

- a node is treated as inside a group when the node's center point falls inside the group's bounds
- if multiple groups overlap, OpenAgent uses the smallest group that contains the selected text node

This keeps the rule deterministic even when groups overlap.

## Multiple Markdown Files

If a matching group contains multiple markdown file nodes, OpenAgent includes all of them as default context.

That means:

- all matching markdown file nodes in the chosen group are read
- their full contents are added to the prompt context
- the result node still belongs to the selected text node, not to each markdown file node

## What Counts As Markdown Context

Only Canvas `file` nodes that resolve to `.md` files are included.

Other node types are not currently treated as group context.

## What It Is Not

Group context is not:

- flow execution
- subgraph traversal
- edge-based follow-up recovery
- a general "include everything near this node" rule

It is specifically a new-thread prompt assembly rule for markdown files inside a group.

## Example

Imagine a Canvas group named `research` with:

- one text node: `Summarize the implementation plan`
- one file node: `spec.md`
- one file node: `notes.md`

If you select only the text node and run `OpenAgent: New thread from selection`, OpenAgent treats:

- the text node as the main request
- `spec.md` and `notes.md` as implicit supporting context

## Related Docs

- [README.md](https://github.com/openagentmarket/openagent/blob/main/README.md)
- [docs/USER_GUIDE.md](./USER_GUIDE.md)
- [OpenAgent Canvas UX Guide.md](https://github.com/openagentmarket/openagent/blob/main/OpenAgent%20Canvas%20UX%20Guide.md)
- [docs/OBSIDIAN_CANVAS_REFERENCE.md](./OBSIDIAN_CANVAS_REFERENCE.md)
