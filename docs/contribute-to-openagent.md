---
title: Contribute to OpenAgent
---

# Contribute to OpenAgent

Use this page if you are here to change code, debug the product, or ship plugin updates.

## The Fastest Reading Order For Contributors

1. [README](https://github.com/openagentmarket/openagent/blob/main/README.md)
2. [Project Map](./concepts/project-map.md)
3. [Architecture](./engineering/architecture.md)
4. [Plugin Development](./engineering/plugin-development.md)

If your work touches packaging or releases, also read:

5. [Plugin Release](./engineering/plugin-release.md)

## What Each Contributor Usually Needs

### New contributor

You need:

- the repo map
- the main runtime surfaces
- where local state lives versus source code

Read:

- [Project Map](./concepts/project-map.md)

### Plugin contributor

You need:

- command registration and UI flow
- canvas selection behavior
- result-node sync behavior
- local plugin reload workflow

Read:

- [Plugin Development](./engineering/plugin-development.md)
- [Architecture](./engineering/architecture.md)
- [Task Stream Flow](./engineering/task-stream-flow.md)

### Daemon or shared-core contributor

You need:

- task identity rules
- canonical task state ownership
- task lifecycle and persistence

Read:

- [Architecture](./engineering/architecture.md)
- [Project Map](./concepts/project-map.md)

### Release owner

You need:

- plugin packaging workflow
- release artifacts
- the release checklist

Read:

- [Plugin Release](./engineering/plugin-release.md)

## Practical Rule

If you are changing user-visible behavior, do not stop at reading architecture notes.

Prefer the smallest relevant verification step:

- plugin/UI behavior: run the relevant smoke test
- selection or follow-up behavior: validate with the documented user flow
- release workflow: follow the release doc exactly

## When To Leave Contributor Docs

If you catch yourself trying to understand the product experience first, step back and read:

- [Evaluate OpenAgent](./evaluate-openagent.md)
- [Use OpenAgent in Obsidian](./use-openagent-in-obsidian.md)
