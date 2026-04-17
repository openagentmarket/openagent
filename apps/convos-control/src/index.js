import "dotenv/config";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import qrcode from "qrcode-terminal";
import { startAgent } from "convos-node-sdk";
import { loadConfig } from "./config.js";
import { ensureControlRoom } from "./control-room.js";
import { OpenAgentDaemonClient } from "./daemon-client.js";
import { enrichControlRoomInvite } from "./invite-artifacts.js";
import { parseMessageContent } from "./parser.js";
import {
  renderBusyStatus,
  renderError,
  renderFinalOutput,
  renderHelp,
  renderJoinAccepted,
  renderNewThread,
  renderRunStarted,
  renderStatus,
  renderStillWorking,
  renderStopResult,
} from "./render.js";
import { collectNewOutput, snapshotMessageIds } from "./task-output.js";

const PROCESSED_MESSAGES_FILENAME = "processed-messages.json";
const MAX_PROCESSED_MESSAGE_KEYS = 500;

async function main() {
  const config = loadConfig();
  const daemon = new OpenAgentDaemonClient({
    baseUrl: config.daemonBaseUrl,
    token: config.daemonToken,
    cwd: config.projectPath,
    runtimeConfig: config.runtimeConfig,
  });

  let runtime = null;
  let controlRoom = null;
  const seenConversationIds = new Set();
  const processedMessageKeys = loadProcessedMessageKeys(config.dataDir);
  const processingMessageKeys = new Set();

  runtime = await startAgent({
    dataDir: config.dataDir,
    env: config.xmtpEnv,
    apiUrl: config.xmtpApiUrl,
    onInvite: async (ctx) => {
      if (!controlRoom || ctx.conversationId !== controlRoom.conversationId) {
        await ctx.reject();
        return;
      }

      console.log(`Accepted join request for control room from ${ctx.joinerInboxId.slice(0, 12)}...`);
      await ctx.accept();
      await runtime?.sendToConversation(ctx.conversationId, renderJoinAccepted(config.projectPath));
    },
    onMessage: async (ctx) => {
      if (!runtime) {
        return;
      }

      const messageKey = await resolveMessageKey(runtime, ctx);
      if (processedMessageKeys.has(messageKey) || processingMessageKeys.has(messageKey)) {
        return;
      }

      processingMessageKeys.add(messageKey);
      if (!seenConversationIds.has(ctx.conversationId)) {
        seenConversationIds.add(ctx.conversationId);
        await runtime.sendToConversation(ctx.conversationId, renderJoinAccepted(config.projectPath));
      }

      try {
        await handleConversationMessage(ctx, runtime, daemon, config, controlRoom);
        rememberProcessedMessageKey(config.dataDir, processedMessageKeys, messageKey);
      } finally {
        processingMessageKeys.delete(messageKey);
      }
    },
    onStart: (info) => {
      console.log(`Runtime XMTP address: ${info.address}`);
      console.log(`Runtime inbox: ${info.inboxId}`);
      console.log(`Convos test URL: ${info.testUrl}`);
    },
    onError: (error) => {
      console.error(`Runtime error: ${error.message}`);
    },
  });

  controlRoom = await ensureControlRoom(runtime, {
    dataDir: config.dataDir,
    name: config.controlRoomName,
    description: config.controlRoomDescription,
  });
  controlRoom = enrichControlRoomInvite(controlRoom, config.dataDir);

  printStartupSummary({
    address: runtime.address,
    controlRoom,
  });

  const shutdown = async (signal) => {
    console.log(`Shutting down (${signal})...`);
    await runtime?.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

async function handleConversationMessage(ctx, runtime, daemon, config, controlRoom) {
  const parsed = parseMessageContent(ctx.content);

  if (parsed.kind === "ignore") {
    return;
  }

  if (parsed.kind === "help") {
    await ctx.send(renderHelp());
    return;
  }

  if (parsed.kind === "status") {
    const [health, binding] = await Promise.all([
      daemon.getHealth(),
      daemon.getConversationBinding(ctx.conversationId).catch(() => ({ channel: null, task: null })),
    ]);
    await runtime.sendToConversation(ctx.conversationId, renderStatus({
      projectPath: config.projectPath,
      conversationId: ctx.conversationId,
      inviteUrl: controlRoom?.inviteUrl || null,
      deepLink: controlRoom?.deepLink || null,
      qrPngPath: controlRoom?.qrPngPath || null,
      daemonBaseUrl: config.daemonBaseUrl,
      taskId: binding.task?.taskId || null,
      threadId: binding.task?.threadId || binding.channel?.threadId || null,
      status: binding.task?.status || (health?.runtime?.ok ? "idle" : "offline"),
    }));
    return;
  }

  if (parsed.kind === "new-thread") {
    await daemon.ensureConversationTask(ctx.conversationId, {
      title: makeTaskTitle(ctx),
      forceNewTask: true,
    });
    await runtime.sendToConversation(ctx.conversationId, renderNewThread());
    return;
  }

  if (parsed.kind === "stop") {
    const binding = await daemon.getConversationBinding(ctx.conversationId).catch(() => ({ task: null }));
    const taskId = binding.task?.taskId;
    if (!taskId) {
      await runtime.sendToConversation(ctx.conversationId, renderStopResult(false));
      return;
    }

    await daemon.interruptTask(taskId);
    await runtime.sendToConversation(ctx.conversationId, renderStopResult(true));
    return;
  }

  const ensured = await daemon.ensureConversationTask(ctx.conversationId, {
    title: makeTaskTitle(ctx),
  });
  const task = ensured.task;
  if (!task?.taskId) {
    throw new Error("OpenAgent did not return a task for this conversation.");
  }

  if (task.status === "starting" || task.status === "running") {
    await runtime.sendToConversation(ctx.conversationId, renderBusyStatus());
    return;
  }

  const previousMessageIds = snapshotMessageIds(task);
  await runtime.sendToConversation(ctx.conversationId, renderRunStarted(config.projectPath));

  let didSendStillWorking = false;
  const statusTimer = setTimeout(() => {
    didSendStillWorking = true;
    void runtime.sendToConversation(ctx.conversationId, renderStillWorking());
  }, config.statusUpdateDelayMs);

  try {
    const started = await daemon.sendMessage(task.taskId, parsed.text);
    const completed = await daemon.waitForTaskCompletion(started.task.taskId);
    clearTimeout(statusTimer);
    const output = collectNewOutput(completed.task, previousMessageIds);
    await runtime.sendToConversation(ctx.conversationId, renderFinalOutput(output));
  } catch (error) {
    clearTimeout(statusTimer);
    await runtime.sendToConversation(ctx.conversationId, renderError(error));
  }
}

function printStartupSummary(input) {
  console.log("");
  console.log("Control room ready");
  console.log(`Name: ${input.controlRoom.name}`);
  console.log(`Address: ${input.address}`);
  console.log(`Conversation ID: ${input.controlRoom.conversationId}`);
  console.log(`Invite URL: ${input.controlRoom.inviteUrl}`);
  console.log(`Convos Deep Link: ${input.controlRoom.deepLink}`);
  if (input.controlRoom.qrPngPath) {
    console.log(`QR PNG: ${input.controlRoom.qrPngPath}`);
  }
  console.log("");
  qrcode.generate(input.controlRoom.deepLink, { small: true });
}

function makeTaskTitle(ctx) {
  const senderLabel = ctx.senderName && ctx.senderName !== "unknown"
    ? String(ctx.senderName).trim()
    : String(ctx.senderInboxId || ctx.conversationId || "conversation").slice(0, 8);
  return `XMTP ${senderLabel}`;
}

function processedMessagesPath(dataDir) {
  return path.join(dataDir, PROCESSED_MESSAGES_FILENAME);
}

function loadProcessedMessageKeys(dataDir) {
  const statePath = processedMessagesPath(dataDir);
  if (!fs.existsSync(statePath)) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!Array.isArray(parsed.keys)) {
      return new Set();
    }

    return new Set(
      parsed.keys.filter((value) => typeof value === "string" && value.length > 0),
    );
  } catch {
    return new Set();
  }
}

function rememberProcessedMessageKey(dataDir, processedMessageKeys, messageKey) {
  processedMessageKeys.add(messageKey);
  while (processedMessageKeys.size > MAX_PROCESSED_MESSAGE_KEYS) {
    const oldestKey = processedMessageKeys.values().next().value;
    if (!oldestKey) {
      break;
    }
    processedMessageKeys.delete(oldestKey);
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    processedMessagesPath(dataDir),
    JSON.stringify({ keys: Array.from(processedMessageKeys) }, null, 2),
    "utf8",
  );
}

async function resolveMessageKey(runtime, ctx) {
  try {
    const conversation = await runtime.agent.client.conversations.getConversationById(ctx.conversationId);
    const message = await conversation?.lastMessage?.();
    if (
      message
      && message.senderInboxId === ctx.senderInboxId
      && normalizeMessageContent(message.content) === normalizeMessageContent(ctx.content)
      && typeof message.id === "string"
      && message.id.length > 0
    ) {
      return `message:${message.id}`;
    }
  } catch {
    return `fallback:${fingerprintMessage(ctx)}`;
  }

  return `fallback:${fingerprintMessage(ctx)}`;
}

function fingerprintMessage(ctx) {
  return createHash("sha256")
    .update(String(ctx.conversationId || ""))
    .update("\n")
    .update(String(ctx.senderInboxId || ""))
    .update("\n")
    .update(normalizeMessageContent(ctx.content))
    .digest("hex");
}

function normalizeMessageContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (
    content
    && typeof content === "object"
    && "content" in content
    && typeof content.content === "string"
  ) {
    return content.content.trim();
  }

  try {
    return JSON.stringify(content, (_, value) => (typeof value === "bigint" ? value.toString() : value));
  } catch {
    return String(content);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
