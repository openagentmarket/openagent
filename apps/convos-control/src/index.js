import "dotenv/config";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import qrcode from "qrcode-terminal";
import { startAgent } from "convos-node-sdk";
import { loadConfig, resolveSelectedProjectPath, saveSelectedProjectPath } from "./config.js";
import { startDashboardServer } from "./dashboard-server.js";
import { OpenAgentDaemonClient } from "./daemon-client.js";
import { createManagedRoom, ManagedRoomStore } from "./managed-rooms.js";
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
    cwd: config.projectPath || "",
    runtimeConfig: config.runtimeConfig,
  });

  let runtime = null;
  let primaryRoom = null;
  let runtimeInfo = {
    address: "",
    inboxId: "",
    testUrl: "",
  };
  const seenConversationIds = new Set();
  const processedMessageKeys = loadProcessedMessageKeys(config.dataDir);
  const processingMessageKeys = new Set();
  const roomStore = new ManagedRoomStore(config.dataDir);

  runtime = await startAgent({
    dataDir: config.dataDir,
    env: config.xmtpEnv,
    apiUrl: config.xmtpApiUrl,
    onInvite: async (ctx) => {
      if (!roomStore.hasConversation(ctx.conversationId)) {
        await ctx.reject();
        return;
      }

      console.log(`Accepted join request for managed room ${ctx.conversationId} from ${ctx.joinerInboxId.slice(0, 12)}...`);
      await ctx.accept();
      await runtime?.sendToConversation(ctx.conversationId, renderJoinAccepted(config.projectPath));
    },
    onMessage: async (ctx) => {
      if (!runtime) {
        return;
      }

      if (await isDirectConversation(runtime, ctx.conversationId)) {
        console.log(`Ignored direct message conversation ${ctx.conversationId}`);
        return;
      }

      if (!roomStore.hasConversation(ctx.conversationId)) {
        console.log(`Ignored message from unmanaged conversation ${ctx.conversationId}`);
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
        await handleConversationMessage(ctx, runtime, daemon, config, roomStore);
        rememberProcessedMessageKey(config.dataDir, processedMessageKeys, messageKey);
      } finally {
        processingMessageKeys.delete(messageKey);
      }
    },
    onStart: (info) => {
      runtimeInfo = {
        address: info.address,
        inboxId: info.inboxId,
        testUrl: info.testUrl,
      };
      console.log(`Runtime XMTP address: ${info.address}`);
      console.log(`Runtime inbox: ${info.inboxId}`);
      console.log(`Convos test URL: ${info.testUrl}`);
    },
    onError: (error) => {
      console.error(`Runtime error: ${error.message}`);
    },
  });

  roomStore.removeByKind("control-room");
  if (!config.projectPath) {
    roomStore.clear();
  }
  primaryRoom = getPrimaryRoom(config, roomStore);

  const dashboardServer = startDashboardServer({
    host: config.dashboardHost,
    port: config.dashboardPort,
    getProjectPath: () => config.projectPath || "",
    roomStore,
    getRuntimeInfo: () => runtimeInfo,
    createRoom: async () => {
      requireProjectPath(config);
      const room = await createManagedRoom(runtime, daemon, config, roomStore, {});
      return room;
    },
    setProjectPath: async (projectPath) => {
      const resolvedPath = resolveSelectedProjectPath(projectPath);
      if (!resolvedPath) {
        throw new Error("Project path is required.");
      }

      const previousProjectPath = config.projectPath || "";
      const previousDaemonCwd = daemon.cwd;
      const previousRooms = roomStore.getAll();
      const changed = resolvedPath !== previousProjectPath;

      config.projectPath = resolvedPath;
      daemon.cwd = resolvedPath;

      try {
        if (changed) {
          roomStore.clear();
        }

        primaryRoom = getPrimaryRoom(config, roomStore);
        saveSelectedProjectPath(config.dataDir, resolvedPath);
        printStartupSummary({
          address: runtime.address,
          projectPath: config.projectPath,
          primaryRoom,
          dashboardUrl: `http://${config.dashboardHost}:${config.dashboardPort}`,
        });

        return {
          projectPath: config.projectPath,
          primaryRoom,
        };
      } catch (error) {
        config.projectPath = previousProjectPath;
        daemon.cwd = previousDaemonCwd;
        roomStore.clear();
        for (const room of previousRooms.slice().reverse()) {
          roomStore.upsert(room);
        }
        primaryRoom = roomStore.getAll()[0] || null;
        throw error;
      }
    },
  });

  printStartupSummary({
    address: runtime.address,
    projectPath: config.projectPath,
    primaryRoom,
    dashboardUrl: `http://${config.dashboardHost}:${config.dashboardPort}`,
  });

  const shutdown = async (signal) => {
    console.log(`Shutting down (${signal})...`);
    dashboardServer.close();
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

async function handleConversationMessage(ctx, runtime, daemon, config, roomStore) {
  const parsed = parseMessageContent(ctx.content);
  const room = roomStore.getByConversationId(ctx.conversationId);

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
    if (binding) {
      roomStore.updateBinding(ctx.conversationId, binding);
    }
    const nextRoom = roomStore.getByConversationId(ctx.conversationId) || room;
    await runtime.sendToConversation(ctx.conversationId, renderStatus({
      projectPath: config.projectPath,
      conversationId: ctx.conversationId,
      inviteUrl: nextRoom?.inviteUrl || null,
      deepLink: nextRoom?.deepLink || null,
      qrPngPath: nextRoom?.qrPngPath || null,
      daemonBaseUrl: config.daemonBaseUrl,
      taskId: binding.task?.taskId || null,
      threadId: binding.task?.threadId || binding.channel?.threadId || null,
      status: binding.task?.status || (health?.runtime?.ok ? "idle" : "offline"),
    }));
    return;
  }

  if (parsed.kind === "new-thread") {
    const binding = await daemon.ensureConversationTask(ctx.conversationId, {
      title: makeTaskTitle(ctx),
      forceNewTask: true,
    });
    roomStore.updateBinding(ctx.conversationId, binding);
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
  roomStore.updateBinding(ctx.conversationId, ensured);
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
  console.log(`Address: ${input.address}`);
  console.log(`Dashboard: ${input.dashboardUrl}`);

  if (!input.primaryRoom) {
    if (input.projectPath) {
      console.log("No chat created yet");
      console.log("Open the dashboard and press New Thread when you're ready.");
    } else {
      console.log("Project setup required");
      console.log("Open the dashboard and choose the local repo path first.");
    }
    console.log("");
    return;
  }

  console.log("Default chat ready");
  console.log(`Name: ${input.primaryRoom.name}`);
  console.log(`Conversation ID: ${input.primaryRoom.conversationId}`);
  console.log(`Invite URL: ${input.primaryRoom.inviteUrl}`);
  console.log(`Convos Deep Link: ${input.primaryRoom.deepLink}`);
  if (input.primaryRoom.qrPngPath) {
    console.log(`QR PNG: ${input.primaryRoom.qrPngPath}`);
  }
  console.log("");
  qrcode.generate(input.primaryRoom.qrTarget || input.primaryRoom.inviteUrl || input.primaryRoom.deepLink, { small: true });
}

function getPrimaryRoom(config, roomStore) {
  if (!config.projectPath) {
    return null;
  }

  return roomStore.getAll()[0] || null;
}

function requireProjectPath(config) {
  if (!config.projectPath) {
    throw new Error("Choose a local project folder before creating chats.");
  }
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

async function isDirectConversation(runtime, conversationId) {
  try {
    const conversation = await runtime.agent.client.conversations.getConversationById(conversationId);
    return conversation?.constructor?.name === "Dm";
  } catch {
    return false;
  }
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
