# OpenAgent

OpenAgent turns Obsidian Canvas into a local workspace for working with Codex right where you already think, take notes, and plan.

## What It Does

- Turn selected Canvas nodes into a focused Codex task.
- Keep the prompt, context, repo, and result in one workspace.
- Write the assistant response back onto the Canvas as a new node.
- Make work feel visual and traceable instead of trapped in separate chats.

## The Problem It Solves

Normally, when you are working in Obsidian, you have to copy notes into a chat, explain the repo again, wait for a result, and then manually bring that answer back into your notes.

OpenAgent closes that loop.

You think on the Canvas.
Codex works from those nodes.
The result comes back to the Canvas.

## How It Works

1. Open a Canvas in Obsidian.
2. Select the task node and any related context nodes.
3. Run `OpenAgent: New thread from selection`.
4. OpenAgent sends the context to the local daemon and runs the task with Codex.
5. The result is written back as a new node linked to the original one.

## Why Users Find It Useful

- Less context switching between notes, chat, terminal, and repo.
- Each question or bug can become its own thread directly on the Canvas.
- The history of thinking, decisions, and results stays visible as a graph.
- Useful for debugging, research, planning, code review, onboarding, and docs.
- Local-first: your repo and working data stay on your machine.

## What Makes It Different

- It is not a separate AI chat disconnected from your workspace.
- It is not a static Canvas used only for planning.
- It is a working surface where thinking, context, and execution stay connected.

## Short User-Facing Intro

"OpenAgent lets you work with Codex directly from Obsidian Canvas. You select a few nodes as context, run the task, and the result comes back onto the graph instead of getting stuck in a separate chat window."

## 30-Second Demo Flow

- Select a node with a question, task, or bug.
- Add a markdown note as context if needed.
- Run the command to start a new thread.
- Show that the source node is highlighted while the task is running.
- Wait for the response to appear as a new node on the Canvas.
- Emphasize that the full context and result stay in the same workspace.

## Best Fit

- Developers who already use Obsidian to manage technical work.
- Founders or PMs who think in graphs, nodes, and linked notes.
- Small teams that want project context to stay close to decision-making.

## One-Line Pitch

OpenAgent turns Obsidian Canvas from a place where work is planned into a place where work with Codex actually begins.
