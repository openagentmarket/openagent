# OpenAgent Mobile Guide

This guide shows how to use OpenAgent from the Convos app on your phone while keeping Codex local on your own machine.

## What You Are Actually Using

When you chat from Convos:

- Convos is the mobile chat UI
- OpenAgent is the local bridge
- `openagent-daemon` runs on your Mac
- Codex still works against the local repo on your disk

So even though the conversation happens on your phone, the coding work still happens locally on your computer.

## What You Need

- a Mac running this repo
- Node.js 20+
- `pnpm`
- the Convos app on your phone
- an XMTP environment set through `XMTP_ENV`

## Start OpenAgent

From the root of this repo, start the local daemon first:

```bash
pnpm dev:daemon
```

Then start the Convos bridge:

```bash
XMTP_ENV=production pnpm dev:convos
```

If you use a different XMTP environment, replace `production` with the environment you want.

## Open the Dashboard

After both processes are running, open:

- [http://127.0.0.1:4321](http://127.0.0.1:4321)

This dashboard is the local control surface for mobile chats.

## First-Time Setup

If this is your first time using the dashboard, you will see a repo picker.

1. Click `Browse Folder` or paste the absolute path to your local repo.
2. Click `Use This Repo`.
3. Once the repo is connected, click `New Thread`.

OpenAgent does not create a chat automatically after repo selection. You create a chat only when you press `New Thread`.

## How to Start a Chat from Your Phone

Once a thread exists, the dashboard shows:

- a QR code
- a `Copy Invite` button

To start chatting:

1. Open Convos on your phone.
2. Scan the QR code from the dashboard.
3. Join the room in Convos.
4. Send messages from your phone.

That room is now connected to your local Codex runtime.

## Thread Model

Each Convos room maps to one OpenAgent chat context.

That means:

- one room = one Codex context
- `New Thread` creates a fresh room with a fresh context
- reopening an old room resumes the same context for that room

This is the easiest mental model:

- one mobile room
- one local Codex context

## Change Repo

If you want to point OpenAgent at a different local repo:

1. Click `Change Repo` in the dashboard.
2. Pick another folder.
3. Click `Use This Repo`.
4. Click `New Thread` when you want a new room for that repo.

Changing repos does not automatically create a new QR code. The QR appears only after you create a thread.

## Access Mode

The dashboard lets you choose how much filesystem access local Codex gets for future runs:

- `Workspace Only`
- `Full Access`

This setting applies to new work sent from the dashboard flow. If you are not sure, keep it on `Workspace Only`.

## Typical Flow

The normal flow looks like this:

1. Start `openagent-daemon`.
2. Start `convos-control`.
3. Open the local dashboard.
4. Choose the repo you want Codex to control.
5. Press `New Thread`.
6. Scan the QR with Convos.
7. Chat from your phone.
8. Press `New Thread` again whenever you want a fresh context.

## What the Dashboard Is For

The dashboard is only for local setup and room creation.

Use it to:

- choose the local repo
- switch repos later
- create a new thread
- copy an invite
- scan the QR
- choose `Workspace Only` or `Full Access`

Use Convos for the actual conversation.

## What Stays Local

OpenAgent is designed so the important parts remain on your machine:

- the repo stays local
- the daemon stays local
- Codex runs locally
- the dashboard stays on `127.0.0.1`

Convos is just the remote interface for talking to that local runtime.
