#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_STATE_PATH = path.join(os.homedir(), ".openagent", "daemon-state.json");
const DEFAULT_KEEP_RECENT_TASKS = 80;
const DEFAULT_KEEP_RECENT_DAYS = 14;
const DEFAULT_KEEP_MESSAGES_PER_TASK = 2;
const DEFAULT_MAX_MESSAGE_TEXT_LENGTH = 4000;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxLength) {
    return text;
  }

  const suffix = "...";
  return `${text.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}

function toTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sanitizeMessage(message, maxTextLength) {
  return {
    id: String(message?.id || message?.streamKey || ""),
    streamKey: String(message?.streamKey || ""),
    role: String(message?.role || "system"),
    kind: String(message?.kind || ""),
    turnId: message?.turnId || null,
    itemId: message?.itemId || null,
    text: truncateText(message?.text || "", maxTextLength),
    createdAt: message?.createdAt || null,
    updatedAt: message?.updatedAt || null,
  };
}

function selectRetainedMessages(messages, keepMessagesPerTask, maxTextLength) {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  if (normalizedMessages.length <= keepMessagesPerTask) {
    return normalizedMessages.map((message) => sanitizeMessage(message, maxTextLength));
  }

  const retained = [];
  const lastUserIndex = [...normalizedMessages]
    .reverse()
    .findIndex((message) => String(message?.role || "") === "user");
  const resolvedLastUserIndex = lastUserIndex >= 0 ? normalizedMessages.length - lastUserIndex - 1 : -1;
  const latestAssistantIndex = [...normalizedMessages]
    .reverse()
    .findIndex((message) => String(message?.role || "") === "assistant" && String(message?.text || "").trim());
  const resolvedLatestAssistantIndex = latestAssistantIndex >= 0 ? normalizedMessages.length - latestAssistantIndex - 1 : -1;

  [resolvedLastUserIndex, resolvedLatestAssistantIndex].forEach((index) => {
    if (index < 0) {
      return;
    }

    const message = normalizedMessages[index];
    if (!message) {
      return;
    }

    retained.push({
      index,
      message: sanitizeMessage(message, maxTextLength),
    });
  });

  if (retained.length === 0) {
    return normalizedMessages
      .slice(-keepMessagesPerTask)
      .map((message) => sanitizeMessage(message, maxTextLength));
  }

  const uniqueRetained = Array.from(new Map(retained.map((entry) => [entry.index, entry])).values())
    .sort((left, right) => left.index - right.index)
    .slice(-keepMessagesPerTask)
    .map((entry) => entry.message);

  return uniqueRetained;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const statePath = Array.from(args).find((arg) => !arg.startsWith("--")) || DEFAULT_STATE_PATH;
  const dryRun = args.has("--dry-run");
  const keepRecentTasks = parsePositiveInteger(process.env.OPENAGENT_PRUNE_KEEP_TASKS, DEFAULT_KEEP_RECENT_TASKS);
  const keepRecentDays = parsePositiveInteger(process.env.OPENAGENT_PRUNE_KEEP_DAYS, DEFAULT_KEEP_RECENT_DAYS);
  const keepMessagesPerTask = parsePositiveInteger(
    process.env.OPENAGENT_PRUNE_KEEP_MESSAGES_PER_TASK,
    DEFAULT_KEEP_MESSAGES_PER_TASK
  );
  const maxMessageTextLength = parsePositiveInteger(
    process.env.OPENAGENT_PRUNE_MAX_MESSAGE_TEXT_LENGTH,
    DEFAULT_MAX_MESSAGE_TEXT_LENGTH
  );

  if (!fs.existsSync(statePath)) {
    throw new Error(`State file not found: ${statePath}`);
  }

  const raw = fs.readFileSync(statePath, "utf8");
  const state = JSON.parse(raw);
  const tasks = Object.values(state?.tasks || {});
  const sortedTasks = [...tasks].sort((left, right) => toTimestamp(right?.updatedAt) - toTimestamp(left?.updatedAt));
  const keepAfterTimestamp = Date.now() - (keepRecentDays * 24 * 60 * 60 * 1000);

  let prunedTaskCount = 0;
  let removedMessageCount = 0;
  let truncatedMessageCount = 0;

  sortedTasks.forEach((task, index) => {
    const taskId = String(task?.taskId || "").trim();
    if (!taskId) {
      return;
    }

    const messages = Array.isArray(task.messages) ? task.messages : [];
    if (messages.length === 0) {
      return;
    }

    const isRecentByIndex = index < keepRecentTasks;
    const isRecentByDate = toTimestamp(task.updatedAt) >= keepAfterTimestamp;
    const isRunning = ["starting", "running"].includes(String(task?.status || ""));
    const hasActiveTurn = Boolean(task?.currentTurnId);
    if (isRecentByIndex || isRecentByDate || isRunning || hasActiveTurn) {
      return;
    }

    const retainedMessages = selectRetainedMessages(messages, keepMessagesPerTask, maxMessageTextLength);
    removedMessageCount += Math.max(0, messages.length - retainedMessages.length);
    truncatedMessageCount += retainedMessages.filter((message) => {
      const original = messages.find((entry) => String(entry?.id || entry?.streamKey || "") === String(message.id || message.streamKey || ""));
      return String(original?.text || "").trim() !== String(message.text || "");
    }).length;

    state.tasks[taskId] = {
      ...task,
      messages: retainedMessages,
    };
    prunedTaskCount += 1;
  });

  const nextRaw = `${JSON.stringify(state, null, 2)}\n`;
  const nextSize = Buffer.byteLength(nextRaw);
  const previousSize = Buffer.byteLength(raw);
  const summary = {
    statePath,
    dryRun,
    keepRecentTasks,
    keepRecentDays,
    keepMessagesPerTask,
    maxMessageTextLength,
    totalTasks: tasks.length,
    prunedTaskCount,
    removedMessageCount,
    truncatedMessageCount,
    previousSizeBytes: previousSize,
    nextSizeBytes: nextSize,
    bytesSaved: Math.max(0, previousSize - nextSize),
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const backupPath = `${statePath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.copyFileSync(statePath, backupPath);
  fs.writeFileSync(statePath, nextRaw, "utf8");

  console.log(JSON.stringify({
    ...summary,
    backupPath,
  }, null, 2));
}

main();
