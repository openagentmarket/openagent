# OpenAgent with Convos

This guide explains how to use OpenAgent from Convos on your phone while keeping Codex local on your own machine.

## What This Does

OpenAgent can turn Convos into a mobile chat surface for your local Codex runtime.

The important part is that Convos is only the interface. The actual work still runs locally:

- your Mac runs `openagent-daemon`
- your repo stays on your disk
- Codex runs against that local repo
- Convos lets you talk to that local runtime from your phone

In practice, this feels like "chatting with Codex from mobile," but the execution still happens on your machine.

## How It Works

The current flow looks like this:

1. Start `openagent-daemon` on your Mac.
2. Start `convos-control`.
3. Open the local dashboard at `http://127.0.0.1:4321`.
4. Scan the QR code with the Convos app.
5. Send messages from Convos.
6. OpenAgent forwards those messages into your local daemon and local Codex thread.

## Why This Is Useful

This gives you a simple remote workflow:

- check in on a coding task from your phone
- continue a local Codex chat away from the keyboard
- spin up a fresh chat context with one tap
- keep the repo, runtime, and execution local

## Thread Model

Each Convos chat room maps to one OpenAgent chat context.

That means:

- one room is one Codex context
- `New Thread` creates a fresh room with a fresh context
- going back to an existing room resumes that room's conversation

## Local Dashboard

The local dashboard is the place where you create and manage chats.

The current UI is intentionally simple:

- a QR code for the current chat
- a `Copy Invite` button
- a `New Thread` button for a fresh context

Open the dashboard here:

- [http://127.0.0.1:4321](http://127.0.0.1:4321)

## Typical Flow

1. Start OpenAgent locally.
2. Open the dashboard.
3. Scan the QR code from Convos on your phone.
4. Chat from Convos.
5. When you want a clean context, press `New Thread` on the dashboard and scan the new QR code.

## Mental Model

The easiest way to think about this setup is:

- Convos is the remote chat UI
- OpenAgent is the local bridge
- `openagent-daemon` is the local runtime
- Codex still runs on your machine

So even though the conversation happens on mobile, the coding work still happens locally.
