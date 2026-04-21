

This document summarizes the Canvas experiences OpenAgent supports today from a user point of view.

It is intentionally product-facing. For implementation details, see [ARCHITECTURE.md](./ARCHITECTURE.md). For setup and commands outside Canvas, see [USER_GUIDE.md](./USER_GUIDE.md).

## What Canvas Is In OpenAgent

OpenAgent uses Obsidian Canvas as the main working surface for Codex tasks.

The idea is:

- keep the repo, prompt, context, and result attached to the same visual graph
- let users start work from a node instead of a separate chat window
- write assistant output back into the canvas so the graph stays current

Canvas is not just a visualization layer. It is the place where task context is selected, threads are continued, and results are organized.

## Core Mental Model

There are five user-facing concepts to keep in mind:

### 1. Workspace

A workspace is a vault folder under `Workspaces/` that points to one real repo on disk.

Each workspace has:

- a `workspace.json`
- a default `Main.canvas`

The workspace decides which repo Codex should use.

The important detail is that the repo binding lives in `workspace.json`, not in the `.canvas` file itself.

Any canvas inside that workspace folder inherits the same repo. A new canvas does not need its own repo setting as long as it stays inside the workspace folder.

For example:

- `Workspaces/my-app/Main.canvas` -> linked to the repo in `Workspaces/my-app/workspace.json`
- `Workspaces/my-app/bugs.canvas` -> linked to the same repo
- `Notes/ideas.canvas` -> not linked through that workspace

### 2. Source node

A source node is the canvas node a user is actively running from.

Today, the main supported source types are:

- text nodes
- markdown file nodes

### 3. Task

A task is OpenAgent's durable record for one canvas selection plus repo context.

A task stores:

- the normalized selection
- the repo working directory
- the Codex thread id, once a thread exists
- streamed messages and tool output
- canvas binding metadata for syncing results back to the graph

### 4. Thread

A thread is the Codex conversation behind a task.

In today's UX, a new thread usually starts from one primary node selection. A thread can later continue through follow-up nodes.

### 5. Result node

When the assistant completes a response, OpenAgent writes the result back into the canvas as a text node connected to the source node.

This keeps the conversation visible in the graph and gives the user something concrete to branch from next.

## What Users Can Do On Canvas Today

### 1. Create a repo workspace and open its canvas

Users can run `OpenAgent: Choose workspace` to:

- open an existing repo workspace
- create a new workspace from an absolute repo path

When a workspace is created, OpenAgent creates a default `Main.canvas` if needed.

This is the normal starting point for a project.

After that, users can create more canvases inside the same workspace folder if they want separate boards for planning, bugs, or specs. Those canvases still belong to the same repo workspace.

### 2. Select nodes and start a new thread

Users can select nodes on a canvas and run:

- `OpenAgent: New thread from selection`

What this does:

1. reads the active canvas selection
2. flushes any pending edits from the canvas editor
3. resolves supported nodes into structured context
4. infers the repo working directory from the workspace
5. creates or reuses a task record
6. starts or resumes a Codex thread through the daemon
7. streams progress into the OpenAgent panel

### Supported selection shapes for starting a new thread

Today, new thread creation is intentionally narrow.

The supported cases are:

- exactly one text node
- exactly one text node plus one or more markdown file nodes
- exactly one markdown file node

The text node acts as the primary user request.

Markdown file nodes act as supporting context. Their file contents are included in the prompt context sent to Codex.

### Group context

OpenAgent also supports a lightweight `group context` pattern for new threads.

If the user starts a new thread from exactly one text node, OpenAgent can look for the smallest Canvas group that contains that text node.

When that group also contains markdown file nodes, those markdown files are added as default context for the new thread even if the user only selected the text node itself.

This means the mental model is:

- the selected text node is the primary request
- markdown file nodes in the same group become implicit supporting context
- markdown file nodes outside that group are not included automatically

If multiple groups overlap, OpenAgent uses the smallest group that contains the selected text node.

### Unsupported selection shapes

Today, `New thread from selection` does not fully support a free-form multi-node flow as a first-class experience.

In particular:

- selecting multiple text nodes for one new thread is not supported
- selecting one linked node does not automatically traverse and include the whole connected subgraph
- unsupported canvas node types are skipped

This means OpenAgent currently treats "start a thread" and "run a whole flow graph" as different ideas, and only the first one is implemented cleanly.

### 3. Continue an existing thread with a follow-up node

Canvas also supports a follow-up pattern.

The intended user move is:

1. start from an initial prompt node
2. let OpenAgent write a result node
3. create a new text node for the next instruction
4. connect that new node to the earlier conversation path
5. run `OpenAgent: New thread from selection` again on the follow-up node

When OpenAgent can detect that the selected node is a follow-up to an existing conversation, it does not start a brand-new thread. Instead, it sends the selected text as the next message in the existing thread.

This is the main linked-node behavior available today.

### Important nuance

The current follow-up UX is not the same as "run this whole cluster as one flow."

It means:

- one node provides the next user message
- OpenAgent finds the upstream thread through the canvas edge structure
- the message is appended to the existing conversation

So the linkage is conversational, not yet graph-execution-based.

Group context does not change this behavior. It only affects new-thread prompt assembly, not follow-up detection.

### 4. See results written back into the canvas

When a response completes, OpenAgent writes a result node into the canvas.

The result UX includes:

- a new text node containing the assistant response
- an edge from the source node to the result node
- metadata on the written node and edge so OpenAgent can sync later
- source-node color updates to show completion

If the same task writes again for the same source node, OpenAgent updates the existing result node instead of endlessly duplicating it.

This keeps the graph readable while preserving the conversational path.

### 5. Use the OpenAgent panel alongside the canvas

The side panel is the operational companion to the canvas.

Users can:

- inspect the active task
- read streamed assistant output and tool output
- switch between recent, running, and archived threads for the current canvas
- reopen the task list with `OpenAgent: Open tasks`
- resume the most relevant task with `OpenAgent: Resume last task`
- stop an active turn with `OpenAgent: Stop active task`

The panel also tries to stay in sync with the active canvas and the most recent node selection, so the visible task usually follows what the user is looking at.

### 6. Send follow-up text from the panel

Once a task exists, users can continue the conversation from the panel composer as well.

This is useful when the next step does not need a new canvas node yet, or when the user wants to stay inside the current task view.

### 7. Auto arrange the active canvas

Users can run:

- `OpenAgent: Auto arrange active canvas`

This rearranges canvas nodes for readability without changing the underlying edges.

This is especially useful after several assistant results have been written back into the graph.

### 8. Trigger auto-run from node color

Canvas supports a lightweight auto-run interaction.

If a supported text or markdown-file node changes to one of the configured trigger colors, OpenAgent can automatically run that node as a fresh task.

Today the trigger colors are green variants used by the plugin internally.

This UX is useful for quick execution from the graph, but it is still node-based, not flow-based.

## UX Patterns That Work Well Today

These are the best-supported user patterns on Canvas right now.

### Pattern 1. Single prompt node

Use one text node with a focused request.

This is the cleanest and most reliable starting point.

### Pattern 2. Prompt node plus markdown context

Use:

- one text node for the ask
- one or more markdown file nodes for local context

This works well for repo work, specs, plans, and note-driven development.

### Pattern 3. Result node plus follow-up node

Use the generated result node as a visible checkpoint, then create a new text node for the next instruction and connect it into the conversation path.

This is the best current way to model a multi-step chain.

### Pattern 4. Canvas as a project map, not as a full flow engine

Today Canvas works best as:

- a prompt graph
- a context map
- a conversation trail

It does not yet behave like a full workflow orchestrator where selecting one node implicitly runs a whole downstream cluster.

## Feedback And Recovery UX

OpenAgent includes a few small recovery behaviors that matter to users:

- if the canvas selection briefly disappears, the plugin can fall back to the most recent selection snapshot
- if the daemon is offline, the plugin can try to start it
- if a task has no working directory yet, the panel can ask the user to set the repo folder
- if a user attempts to send another message while a task is still running, OpenAgent asks them to wait

These are important because the canvas flow is interactive and users often change focus quickly.

## Current Limitations

These limitations are important to state clearly because they shape the current UX.

- A new thread is not yet a first-class "flow run."
- Selecting one node does not automatically include all linked nodes in a cluster.
- Multiple text nodes are not yet supported as one new-thread prompt.
- Follow-up behavior depends on edge-based conversation recovery, not general graph execution semantics.
- Supported source node types are currently narrow: text nodes and markdown file nodes.
- The product is currently optimized for local desktop use with Obsidian Canvas and the local daemon workflow.

## Recommended Product Language

To avoid confusing users, the current Canvas UX should be described with wording like this:

- "Start a thread from this node"
- "Continue this thread with a follow-up node"
- "Use linked nodes as supporting context"
- "Canvas organizes conversations and context"

Wording to avoid for the current implementation:

- "Run this whole flow"
- "Execute this node cluster"
- "Create a thread from any connected graph"

Those phrases imply a graph-execution model that the current product does not fully support yet.

## Short Version

OpenAgent Canvas already supports a strong node-based workflow:

- start from a prompt node
- attach markdown context
- write results back into the graph
- continue through follow-up nodes
- manage running and historical threads from the side panel

What it does not yet support cleanly is treating a connected group of nodes as one explicit flow run.

That distinction is the most important thing for users, designers, and product copy to keep clear.
