#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const {
  DEFAULT_RUNTIME_CONFIG,
  SUPPORTED_SANDBOX_MODES,
  buildCanvasPrompt,
  createChannelBinding,
  createFreshPendingTaskId,
  createFreshTaskId,
  createPendingTaskId,
  createSelectionKey,
  createTaskBinding,
  createTaskId,
  normalizeCanvasBinding,
  normalizeCanvasSelection,
  nowIso,
  stableHash,
} = require("../../../packages/core/src/index.js");

const OPENAGENT_HOME = path.join(os.homedir(), ".openagent");
const CONFIG_PATH = path.join(OPENAGENT_HOME, "daemon-config.json");
const STATE_PATH = path.join(OPENAGENT_HOME, "daemon-state.json");
const DEFAULT_APP_PATH = "/Applications/Codex.app";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const TASK_STORE_SAVE_DEBOUNCE_MS = 75;
const TASK_MESSAGE_PREVIEW_LENGTH = 280;
const AUTOMATION_SCHEDULER_INTERVAL_MS = 60_000;
const AUTOMATION_MESSAGE_PREVIEW_LENGTH = 8_000;
const REALTIME_SDP_WAIT_MS = 12_000;
const REALTIME_SESSION_TTL_MS = 30 * 60_000;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function normalizeWorkingDirectory(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  if (!path.isAbsolute(trimmed)) {
    throw new Error("Working directory must be an absolute path.");
  }

  const normalizedPath = path.normalize(trimmed);
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Working directory does not exist: ${normalizedPath}`);
  }

  const stats = fs.statSync(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${normalizedPath}`);
  }

  return normalizedPath;
}

function resolveSelectionImagePath(file, cwd = "") {
  const absolutePath = String(file?.absolutePath || "").trim();
  if (absolutePath && fs.existsSync(absolutePath)) {
    return absolutePath;
  }

  const relativePath = String(file?.path || "").trim();
  const normalizedCwd = String(cwd || "").trim();
  if (normalizedCwd && relativePath) {
    const candidateAbsolutePath = path.resolve(normalizedCwd, relativePath);
    if (fs.existsSync(candidateAbsolutePath)) {
      return candidateAbsolutePath;
    }
  }

  return "";
}

function buildTurnInputItems(selectionContext, prompt, cwd = "") {
  const selection = normalizeCanvasSelection(selectionContext);
  const items = [];

  selection.imageFiles.forEach((file) => {
    const resolvedPath = resolveSelectionImagePath(file, cwd);
    if (resolvedPath) {
      items.push({
        type: "localImage",
        path: resolvedPath,
      });
    }
  });

  if (prompt) {
    items.push({
      type: "text",
      text: prompt,
      text_elements: [],
    });
  }

  return items;
}

function randomToken() {
  return `${stableHash(nowIso())}${stableHash(Math.random().toString(16))}`;
}

function normalizeRuntimeConfig(input = {}, fallback = DEFAULT_RUNTIME_CONFIG) {
  const approvalPolicy = String(input?.approvalPolicy || fallback?.approvalPolicy || DEFAULT_RUNTIME_CONFIG.approvalPolicy);
  const requestedSandboxMode = String(input?.sandboxMode || fallback?.sandboxMode || DEFAULT_RUNTIME_CONFIG.sandboxMode);
  return {
    approvalPolicy,
    sandboxMode: SUPPORTED_SANDBOX_MODES.has(requestedSandboxMode)
      ? requestedSandboxMode
      : DEFAULT_RUNTIME_CONFIG.sandboxMode,
  };
}

function buildThreadSandboxVariants(sandboxMode) {
  if (sandboxMode === "danger-full-access") {
    return ["dangerFullAccess", "danger-full-access"];
  }
  return ["workspaceWrite", "workspace-write"];
}

function buildTurnSandboxPolicyVariants(sandboxMode, cwd) {
  if (sandboxMode === "danger-full-access") {
    return [
      { type: "dangerFullAccess" },
      { type: "danger-full-access" },
    ];
  }

  return [
    {
      type: "workspaceWrite",
      writableRoots: [cwd],
      networkAccess: false,
    },
    {
      type: "workspace-write",
      writableRoots: [cwd],
      networkAccess: false,
    },
  ];
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message, details = {}) {
  sendJson(response, statusCode, {
    error: {
      message,
      ...details,
    },
  });
}

function parseTaskId(pathname) {
  const match = /^\/tasks\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : "";
}

function parseAutomationId(pathname) {
  const match = /^\/automations\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : "";
}

function compactMessageText(value, maxLength = 0) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (!maxLength || compact.length <= maxLength) {
    return compact;
  }

  const suffix = "...";
  return `${compact.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()}${suffix}`;
}

function normalizeRuntimeErrorMessage(value) {
  const raw = String(value?.message || value || "Unknown runtime error").trim();
  if (!raw) {
    return "Unknown runtime error";
  }

  let message = raw;
  try {
    const parsed = JSON.parse(raw);
    message = String(parsed?.fields?.message || parsed?.message || raw).trim();
  } catch {
    message = raw;
  }

  if (message.includes("codex/realtime/calls") && message.includes("404")) {
    return "Codex realtime WebRTC is unavailable for this ChatGPT session: the realtime calls endpoint returned 404 Not Found.";
  }

  return compactMessageText(message, 360);
}

function buildTaskMessageSummary(task) {
  const messages = Array.isArray(task?.messages) ? task.messages : [];
  const messageCount = messages.length;
  const lastMessage = messageCount > 0 ? messages[messageCount - 1] : null;

  let latestAssistantMessage = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const text = String(message?.text || "");
    if (message?.role !== "assistant" || !text.trim()) {
      continue;
    }

    latestAssistantMessage = {
      id: String(message?.id || message?.streamKey || ""),
      role: "assistant",
      kind: String(message?.kind || ""),
      turnId: message?.turnId || null,
      itemId: message?.itemId || null,
      text,
      createdAt: message?.createdAt || null,
      updatedAt: message?.updatedAt || null,
    };
    break;
  }

  return {
    messageCount,
    lastMessageId: String(lastMessage?.id || lastMessage?.streamKey || ""),
    lastMessageRole: String(lastMessage?.role || ""),
    lastMessagePreview: compactMessageText(lastMessage?.text || "", TASK_MESSAGE_PREVIEW_LENGTH),
    latestAssistantMessage,
  };
}

function normalizeAutomationId(value, fallback = "") {
  return String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || `automation-${stableHash(String(fallback || Date.now()))}`;
}

function parseSimpleCronSchedule(schedule) {
  const raw = String(schedule || "").trim();
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minuteRaw, hourRaw, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") {
    return null;
  }

  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }

  return { minute, hour };
}

function parseIntervalSchedule(schedule) {
  const match = /^every\s+(\d+)\s*(minute|minutes|hour|hours|day|days)$/i.exec(String(schedule || "").trim())
    || /^(\d+)(m|h|d)$/i.exec(String(schedule || "").trim());
  if (!match) {
    return 0;
  }

  const amount = Math.max(1, Number(match[1]) || 0);
  const unit = String(match[2] || "").toLowerCase();
  if (unit === "m" || unit.startsWith("minute")) {
    return amount * 60_000;
  }
  if (unit === "h" || unit.startsWith("hour")) {
    return amount * 60 * 60_000;
  }
  if (unit === "d" || unit.startsWith("day")) {
    return amount * 24 * 60 * 60_000;
  }
  return 0;
}

function computeNextAutomationRunAt(schedule, fromDate = new Date()) {
  const raw = String(schedule || "").trim();
  if (!raw || raw.toLowerCase() === "manual") {
    return null;
  }

  const intervalMs = parseIntervalSchedule(raw);
  if (intervalMs > 0) {
    return new Date(fromDate.getTime() + intervalMs).toISOString();
  }

  const cron = parseSimpleCronSchedule(raw);
  if (!cron) {
    return null;
  }

  const next = new Date(fromDate.getTime());
  next.setSeconds(0, 0);
  next.setHours(cron.hour, cron.minute, 0, 0);
  if (next.getTime() <= fromDate.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function formatAutomationTimestamp(value) {
  const timestamp = String(value || "").trim();
  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function latestAutomationAssistantText(automation) {
  const messages = Array.isArray(automation?.messages) ? automation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && String(message.text || "").trim()) {
      return compactMessageText(message.text, 1_500);
    }
  }
  return "";
}

function createAutomationBinding(input = {}, previous = null) {
  const sourcePath = String(input.sourcePath || previous?.sourcePath || "").trim();
  const automationId = normalizeAutomationId(input.id || previous?.automationId, sourcePath);
  const now = nowIso();
  const schedule = String(input.schedule || previous?.schedule || "manual").trim() || "manual";
  const runtimeConfig = normalizeRuntimeConfig(input.runtimeConfig || previous?.runtimeConfig || DEFAULT_RUNTIME_CONFIG);
  const requestedStatus = String(input.status || "").trim();
  const status = requestedStatus || (
    previous?.status === "running" || previous?.status === "starting"
      ? previous.status
      : "idle"
  );
  const explicitNextRunAt = Object.prototype.hasOwnProperty.call(input, "nextRunAt")
    ? (input.nextRunAt || null)
    : undefined;
  const nextRunAt = explicitNextRunAt !== undefined
    ? explicitNextRunAt
    : status === "running" || status === "starting"
    ? (previous?.nextRunAt || null)
    : (previous?.schedule === schedule && previous?.nextRunAt ? previous.nextRunAt : computeNextAutomationRunAt(schedule));

  return {
    automationId,
    source: String(input.source || previous?.source || "vault").trim() || "vault",
    sourcePath,
    title: String(input.title || previous?.title || automationId).trim() || automationId,
    enabled: input.enabled !== false,
    schedule,
    cwd: String(input.cwd || previous?.cwd || "").trim(),
    prompt: String(input.prompt || previous?.prompt || ""),
    threadStrategy: String(input.threadStrategy || previous?.threadStrategy || "resume").trim() === "new"
      ? "new"
      : "resume",
    runtimeConfig,
    threadId: previous?.threadId || null,
    currentTurnId: previous?.currentTurnId || null,
    status,
    lastError: previous?.lastError || "",
    lastRunAt: previous?.lastRunAt || null,
    nextRunAt,
    activeRunId: input.activeRunId || previous?.activeRunId || null,
    lastRunReport: input.lastRunReport || previous?.lastRunReport || null,
    runHistory: Array.isArray(input.runHistory)
      ? input.runHistory
      : (Array.isArray(previous?.runHistory) ? previous.runHistory : []),
    messages: Array.isArray(previous?.messages) ? previous.messages : [],
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    request.on("data", (chunk) => {
      buffer += String(chunk);
      if (buffer.length > 5_000_000) {
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      if (!buffer.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(buffer));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    request.on("error", reject);
  });
}

class DesktopCodexLocator {
  constructor(appPath = DEFAULT_APP_PATH) {
    this.appPath = appPath;
  }

  resolveAppPath() {
    return fs.existsSync(this.appPath) ? this.appPath : null;
  }

  resolveEmbeddedCodexPath() {
    const appPath = this.resolveAppPath();
    if (!appPath) {
      return null;
    }

    const binaryPath = path.join(appPath, "Contents", "Resources", "codex");
    return fs.existsSync(binaryPath) ? binaryPath : null;
  }

  validateRuntimeAvailable() {
    const appPath = this.resolveAppPath();
    if (!appPath) {
      return {
        ok: false,
        message: "Install Codex.app in /Applications before using OpenAgent.",
      };
    }

    const binaryPath = this.resolveEmbeddedCodexPath();
    if (!binaryPath) {
      return {
        ok: false,
        message: "Codex.app is installed, but its embedded runtime binary is unavailable.",
      };
    }

    try {
      fs.accessSync(binaryPath, fs.constants.X_OK);
    } catch {
      return {
        ok: false,
        message: "Codex.app is installed, but the embedded runtime is not executable.",
      };
    }

    return {
      ok: true,
      appPath,
      binaryPath,
    };
  }
}

class CodexAppServerClient {
  constructor(options) {
    this.binaryPath = options.binaryPath;
    this.cwd = options.cwd;
    this.onNotification = options.onNotification || (() => {});
    this.onRuntimeError = options.onRuntimeError || (() => {});
    this.process = null;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.isInitialized = false;
    this.startPromise = null;
  }

  async start() {
    if (this.isInitialized && this.process && !this.process.killed) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startInternal() {
    if (!this.binaryPath) {
      throw new Error("Codex Desktop runtime binary is unavailable.");
    }

    this.process = spawn(this.binaryPath, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.on("error", (error) => {
      this.failPending(error);
      this.onRuntimeError(error);
    });

    this.process.on("exit", (code, signal) => {
      const message = new Error(
        `Codex runtime stopped unexpectedly${code != null ? ` (code ${code})` : ""}${signal ? ` (${signal})` : ""}.`
      );
      this.failPending(message);
      this.isInitialized = false;
      this.onRuntimeError(message);
    });

    const stdoutReader = readline.createInterface({ input: this.process.stdout });
    stdoutReader.on("line", (line) => this.handleStdoutLine(line));

    const stderrReader = readline.createInterface({ input: this.process.stderr });
    stderrReader.on("line", (line) => {
      const message = line.trim();
      if (message) {
        this.onRuntimeError(new Error(message));
      }
    });

    await this.request("initialize", {
      clientInfo: {
        name: "openagent_daemon",
        title: "OpenAgent Daemon",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    await this.notify("initialized", null);
    this.isInitialized = true;
  }

  stop() {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.isInitialized = false;
  }

  async createOrResumeThread(task, runtimeConfig = DEFAULT_RUNTIME_CONFIG) {
    await this.start();
    const normalizedRuntimeConfig = normalizeRuntimeConfig(runtimeConfig);
    const sandboxVariants = buildThreadSandboxVariants(normalizedRuntimeConfig.sandboxMode);

    if (task.threadId) {
      let lastError = null;
      for (const sandbox of sandboxVariants) {
        try {
          const response = await this.request("thread/resume", {
            threadId: task.threadId,
            cwd: task.cwd,
            approvalPolicy: normalizedRuntimeConfig.approvalPolicy,
            sandbox,
          });
          return response?.thread || response;
        } catch (error) {
          if (this.isThreadMissingError(error)) {
            break;
          }
          lastError = error;
        }
      }

      if (lastError && !this.isThreadMissingError(lastError)) {
        throw lastError;
      }
    }

    let lastError = null;
    for (const sandbox of sandboxVariants) {
      try {
        const response = await this.request("thread/start", {
          cwd: task.cwd,
          approvalPolicy: normalizedRuntimeConfig.approvalPolicy,
          sandbox,
        });
        return response?.thread || response;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Unable to start Codex thread.");
  }

  async forkThread(sourceTask, runtimeConfig = DEFAULT_RUNTIME_CONFIG, options = {}) {
    await this.start();
    const sourceThreadId = String(sourceTask?.threadId || "").trim();
    if (!sourceThreadId) {
      throw new Error("The source task does not have a Codex thread to fork.");
    }

    const normalizedRuntimeConfig = normalizeRuntimeConfig(runtimeConfig);
    const sandboxVariants = buildThreadSandboxVariants(normalizedRuntimeConfig.sandboxMode);
    let lastError = null;

    for (const sandbox of sandboxVariants) {
      try {
        const response = await this.request("thread/fork", {
          threadId: sourceThreadId,
          cwd: sourceTask.cwd,
          approvalPolicy: normalizedRuntimeConfig.approvalPolicy,
          sandbox,
          persistExtendedHistory: true,
        });
        const thread = response?.thread || response;
        const forkedThreadId = String(thread?.id || "").trim();
        const rollbackTurns = Math.max(0, Math.floor(Number(options.rollbackTurns || 0)));
        if (forkedThreadId && rollbackTurns > 0) {
          await this.request("thread/rollback", {
            threadId: forkedThreadId,
            numTurns: rollbackTurns,
          });
        }
        return thread;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Unable to fork Codex thread.");
  }

  async sendTurn(task, inputItems, runtimeConfig = DEFAULT_RUNTIME_CONFIG) {
    await this.start();
    const normalizedRuntimeConfig = normalizeRuntimeConfig(runtimeConfig);
    const sandboxPolicyVariants = buildTurnSandboxPolicyVariants(normalizedRuntimeConfig.sandboxMode, task.cwd);

    let response;

    let lastCompatibilityError = null;
    for (const sandboxPolicy of sandboxPolicyVariants) {
      try {
        response = await this.request("turn/start", {
          threadId: task.threadId,
          cwd: task.cwd,
          input: inputItems,
          approvalPolicy: normalizedRuntimeConfig.approvalPolicy,
          sandboxPolicy,
        });
        return response?.turn || response;
      } catch (error) {
        if (!this.isSandboxPolicyCompatibilityError(error)) {
          throw error;
        }
        lastCompatibilityError = error;
      }
    }

    if (!lastCompatibilityError) {
      throw new Error("Unable to determine a supported sandbox policy.");
    }

    response = await this.request("turn/start", {
      threadId: task.threadId,
      cwd: task.cwd,
      input: inputItems,
      approvalPolicy: normalizedRuntimeConfig.approvalPolicy,
    });

    return response?.turn || response;
  }

  async interrupt(task) {
    await this.start();
    if (!task.threadId || !task.currentTurnId) {
      return {};
    }

    return this.request("turn/interrupt", {
      threadId: task.threadId,
      turnId: task.currentTurnId,
    });
  }

  async startThreadForRealtime(options = {}) {
    await this.start();
    const cwd = normalizeWorkingDirectory(options.cwd || process.cwd());
    const runtimeConfig = normalizeRuntimeConfig(options.runtimeConfig);
    const sandboxVariants = buildThreadSandboxVariants(runtimeConfig.sandboxMode);
    let lastError = null;

    for (const sandbox of sandboxVariants) {
      try {
        const response = await this.request("thread/start", {
          cwd,
          approvalPolicy: runtimeConfig.approvalPolicy,
          sandbox,
          ephemeral: options.ephemeral !== false,
        });
        return response?.thread || response;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Unable to start realtime Codex thread.");
  }

  startRealtimeConversation(params = {}) {
    return this.request("thread/realtime/start", params);
  }

  appendRealtimeText(threadId, text) {
    return this.request("thread/realtime/appendText", {
      threadId,
      text,
    });
  }

  appendRealtimeAudio(threadId, audio) {
    return this.request("thread/realtime/appendAudio", {
      threadId,
      audio,
    });
  }

  stopRealtimeConversation(threadId) {
    return this.request("thread/realtime/stop", {
      threadId,
    });
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        reject(new Error("Codex runtime is not running."));
        return;
      }

      const id = this.nextRequestId++;
      this.pending.set(id, { resolve, reject });
      this.writeMessage({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
    });
  }

  notify(method, params) {
    this.writeMessage({
      jsonrpc: "2.0",
      method,
      params,
    });
    return Promise.resolve();
  }

  writeMessage(message) {
    if (!this.process || this.process.killed) {
      return;
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleStdoutLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      this.onRuntimeError(new Error(`Unable to decode Codex runtime output: ${error.message}`));
      return;
    }

    if (Object.prototype.hasOwnProperty.call(parsed, "id") && !parsed.method) {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }

      this.pending.delete(parsed.id);
      if (parsed.error) {
        pending.reject(this.makeRpcError(parsed.error));
      } else {
        pending.resolve(parsed.result);
      }
      return;
    }

    if (parsed.method) {
      this.onNotification({
        method: parsed.method,
        params: parsed.params || {},
      });
    }
  }

  makeRpcError(error) {
    const rpcError = new Error(error?.message || "Unknown Codex runtime error");
    rpcError.code = error?.code;
    rpcError.data = error?.data;
    return rpcError;
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  isThreadMissingError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("thread not found") || message.includes("not found");
  }

  isSandboxPolicyCompatibilityError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("sandboxpolicy") && (
      message.includes("unknown")
      || message.includes("unexpected")
      || message.includes("invalid")
      || message.includes("field")
    );
  }
}

class TaskStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = readJson(filePath, {
      tasks: {},
      channels: {},
      automations: {},
    });
    this.state.tasks = this.state.tasks || {};
    this.state.channels = this.state.channels || {};
    this.state.automations = this.state.automations || {};
    this.threadTaskIdByThreadId = new Map();
    this.automationIdByThreadId = new Map();
    this.pendingSaveTimer = null;
    this.isDirty = false;
    this.rebuildIndexes();
  }

  save() {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
    }

    if (!this.isDirty) {
      return;
    }

    writeJson(this.filePath, this.state);
    this.isDirty = false;
  }

  scheduleSave() {
    this.isDirty = true;
    if (this.pendingSaveTimer) {
      return;
    }

    this.pendingSaveTimer = setTimeout(() => {
      this.pendingSaveTimer = null;
      this.save();
    }, TASK_STORE_SAVE_DEBOUNCE_MS);

    if (typeof this.pendingSaveTimer?.unref === "function") {
      this.pendingSaveTimer.unref();
    }
  }

  rebuildIndexes() {
    this.threadTaskIdByThreadId.clear();
    Object.values(this.state.tasks).forEach((task) => {
      this.updateThreadIndex(task, null);
    });
    this.automationIdByThreadId.clear();
    Object.values(this.state.automations).forEach((automation) => {
      this.updateAutomationThreadIndex(automation, null);
    });
  }

  updateThreadIndex(nextTask, previousTask = null) {
    const taskId = String(nextTask?.taskId || previousTask?.taskId || "").trim();
    const previousThreadId = String(previousTask?.threadId || "").trim();
    const nextThreadId = String(nextTask?.threadId || "").trim();

    if (previousThreadId && this.threadTaskIdByThreadId.get(previousThreadId) === taskId) {
      this.threadTaskIdByThreadId.delete(previousThreadId);
    }

    if (nextThreadId && taskId) {
      this.threadTaskIdByThreadId.set(nextThreadId, taskId);
    }
  }

  updateAutomationThreadIndex(nextAutomation, previousAutomation = null) {
    const automationId = String(nextAutomation?.automationId || previousAutomation?.automationId || "").trim();
    const previousThreadId = String(previousAutomation?.threadId || "").trim();
    const nextThreadId = String(nextAutomation?.threadId || "").trim();

    if (previousThreadId && this.automationIdByThreadId.get(previousThreadId) === automationId) {
      this.automationIdByThreadId.delete(previousThreadId);
    }

    if (nextThreadId && automationId) {
      this.automationIdByThreadId.set(nextThreadId, automationId);
    }
  }

  getTasks() {
    return Object.values(this.state.tasks).map((task) => createTaskBinding(task)).sort((left, right) => {
      return (right.updatedAt || "").localeCompare(left.updatedAt || "");
    });
  }

  getTask(taskId) {
    return taskId && this.state.tasks[taskId] ? createTaskBinding(this.state.tasks[taskId]) : null;
  }

  getChannelBinding(channelType, channelId) {
    const key = `${String(channelType || "").trim()}:${String(channelId || "").trim()}`;
    return key && this.state.channels[key] ? createChannelBinding(this.state.channels[key]) : null;
  }

  listTasksForSelection(selectionKey) {
    return this.getTasks().filter((task) => task.selectionKey === selectionKey);
  }

  findMostRecentTaskForSelection(selectionKey) {
    return this.listTasksForSelection(selectionKey)[0] || null;
  }

  findTaskByThreadId(threadId) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      return null;
    }

    const taskId = this.threadTaskIdByThreadId.get(normalizedThreadId);
    return taskId ? this.getTask(taskId) : null;
  }

  getAutomations() {
    return Object.values(this.state.automations).map((automation) => ({ ...automation })).sort((left, right) => {
      return (left.title || left.automationId).localeCompare(right.title || right.automationId);
    });
  }

  getAutomation(automationId) {
    const normalizedId = normalizeAutomationId(automationId);
    return normalizedId && this.state.automations[normalizedId]
      ? { ...this.state.automations[normalizedId] }
      : null;
  }

  findAutomationByThreadId(threadId) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      return null;
    }

    const automationId = this.automationIdByThreadId.get(normalizedThreadId);
    return automationId ? this.getAutomation(automationId) : null;
  }

  upsertAutomation(automation) {
    const normalizedAutomation = createAutomationBinding(
      automation,
      this.state.automations[normalizeAutomationId(automation?.automationId || automation?.id)]
    );
    const previousAutomation = this.state.automations[normalizedAutomation.automationId] || null;
    this.state.automations[normalizedAutomation.automationId] = normalizedAutomation;
    this.updateAutomationThreadIndex(normalizedAutomation, previousAutomation);
    this.scheduleSave();
    return this.state.automations[normalizedAutomation.automationId];
  }

  patchAutomation(automationId, patch) {
    const current = this.getAutomation(automationId);
    if (!current) {
      return null;
    }

    return this.upsertAutomation({
      ...current,
      ...patch,
      automationId: current.automationId,
    });
  }

  syncAutomations(incomingAutomations, options = {}) {
    const source = String(options.source || "vault").trim() || "vault";
    const incomingIds = new Set();
    const synced = [];

    for (const automation of Array.isArray(incomingAutomations) ? incomingAutomations : []) {
      const normalized = createAutomationBinding({
        ...automation,
        source,
      }, this.state.automations[normalizeAutomationId(automation?.id || automation?.automationId, automation?.sourcePath)]);
      incomingIds.add(normalized.automationId);
      const previous = this.state.automations[normalized.automationId] || null;
      this.state.automations[normalized.automationId] = normalized;
      this.updateAutomationThreadIndex(normalized, previous);
      synced.push(normalized);
    }

    if (options.pruneMissing !== false) {
      Object.values(this.state.automations).forEach((automation) => {
        if (automation.source === source && !incomingIds.has(automation.automationId)) {
          this.updateAutomationThreadIndex(null, automation);
          delete this.state.automations[automation.automationId];
        }
      });
    }

    this.scheduleSave();
    return synced;
  }

  listDueAutomations(date = new Date()) {
    const nowTime = date.getTime();
    return this.getAutomations().filter((automation) => {
      if (!automation.enabled || automation.status === "running" || automation.status === "starting") {
        return false;
      }
      const nextRunAt = String(automation.nextRunAt || "").trim();
      return nextRunAt && Date.parse(nextRunAt) <= nowTime;
    });
  }

  appendAutomationDelta(automationId, kind, payload) {
    const automation = this.getAutomation(automationId);
    if (!automation) {
      return null;
    }

    const messages = Array.isArray(automation.messages) ? [...automation.messages] : [];
    const streamKey = `${kind}:${payload.turnId || payload.turn_id || "turn"}:${payload.itemId || payload.item_id || "item"}`;
    const index = messages.findIndex((entry) => entry.streamKey === streamKey);
    const previous = index >= 0 ? messages[index] : null;
    const delta = String(payload?.delta || payload?.textDelta || payload?.outputDelta || payload?.output || "");
    const text = compactMessageText(`${previous?.text || ""}${delta}`, AUTOMATION_MESSAGE_PREVIEW_LENGTH);
    const nextMessage = {
      ...(previous || {}),
      id: previous?.id || streamKey,
      streamKey,
      role: kind === "assistant" ? "assistant" : "tool",
      kind,
      turnId: payload.turnId || payload.turn_id || null,
      itemId: payload.itemId || payload.item_id || null,
      text,
      updatedAt: nowIso(),
      createdAt: previous?.createdAt || nowIso(),
    };

    if (index >= 0) {
      messages[index] = nextMessage;
    } else {
      messages.push(nextMessage);
    }

    return this.patchAutomation(automationId, { messages });
  }

  recordAutomationRunStarted(automationId, run) {
    const automation = this.getAutomation(automationId);
    if (!automation) {
      return null;
    }

    const runHistory = [
      {
        runId: run.runId,
        status: "running",
        startedAt: run.startedAt,
        startedAtDisplay: formatAutomationTimestamp(run.startedAt),
        completedAt: null,
        completedAtDisplay: "",
        turnId: run.turnId || null,
        threadId: run.threadId || null,
        error: "",
        report: "",
      },
      ...(Array.isArray(automation.runHistory) ? automation.runHistory : []),
    ].slice(0, 20);

    return this.patchAutomation(automationId, {
      activeRunId: run.runId,
      runHistory,
      lastRunReport: {
        runId: run.runId,
        status: "running",
        startedAt: run.startedAt,
        startedAtDisplay: formatAutomationTimestamp(run.startedAt),
        completedAt: null,
        completedAtDisplay: "",
        error: "",
        report: "",
      },
    });
  }

  recordAutomationRunFinished(automationId, patch) {
    const automation = this.getAutomation(automationId);
    if (!automation) {
      return null;
    }

    const runId = patch.runId || automation.activeRunId || `run:${Date.now()}`;
    const completedAt = patch.completedAt || nowIso();
    let didUpdateRun = false;
    const runHistory = (Array.isArray(automation.runHistory) ? automation.runHistory : []).map((run) => {
      if (run.runId !== runId) {
        return run;
      }
      didUpdateRun = true;
      return {
        ...run,
        status: patch.status,
        completedAt,
        completedAtDisplay: formatAutomationTimestamp(completedAt),
        error: patch.error || "",
        report: patch.report || "",
      };
    });

    if (!didUpdateRun) {
      runHistory.unshift({
        runId,
        status: patch.status,
        startedAt: patch.startedAt || null,
        startedAtDisplay: formatAutomationTimestamp(patch.startedAt),
        completedAt,
        completedAtDisplay: formatAutomationTimestamp(completedAt),
        turnId: patch.turnId || automation.currentTurnId || null,
        threadId: patch.threadId || automation.threadId || null,
        error: patch.error || "",
        report: patch.report || "",
      });
    }

    return this.patchAutomation(automationId, {
      activeRunId: null,
      runHistory: runHistory.slice(0, 20),
      lastRunReport: {
        runId,
        status: patch.status,
        startedAt: patch.startedAt || null,
        startedAtDisplay: formatAutomationTimestamp(patch.startedAt),
        completedAt,
        completedAtDisplay: formatAutomationTimestamp(completedAt),
        error: patch.error || "",
        report: patch.report || "",
      },
    });
  }

  listChannelBindingsForTask(taskId) {
    return Object.values(this.state.channels)
      .map((channel) => createChannelBinding(channel))
      .filter((channel) => channel.taskId === taskId);
  }

  upsertTask(task) {
    const normalizedTask = createTaskBinding({
      ...task,
      updatedAt: nowIso(),
    });
    const previousTask = this.state.tasks[normalizedTask.taskId] || null;
    this.state.tasks[normalizedTask.taskId] = normalizedTask;
    this.updateThreadIndex(normalizedTask, previousTask);
    this.scheduleSave();
    return this.state.tasks[normalizedTask.taskId];
  }

  patchTask(taskId, patch) {
    const current = this.getTask(taskId);
    if (!current) {
      return null;
    }

    return this.upsertTask({
      ...current,
      ...patch,
    });
  }

  appendMessage(taskId, message) {
    const task = this.getTask(taskId);
    if (!task) {
      return null;
    }

    const messages = Array.isArray(task.messages) ? [...task.messages] : [];
    messages.push({
      ...message,
      createdAt: message.createdAt || nowIso(),
    });
    return this.patchTask(taskId, { messages });
  }

  appendDelta(taskId, kind, payload) {
    const task = this.getTask(taskId);
    if (!task) {
      return null;
    }

    const messages = Array.isArray(task.messages) ? [...task.messages] : [];
    const streamKey = `${kind}:${payload.turnId || "turn"}:${payload.itemId || "item"}`;
    const index = messages.findIndex((entry) => entry.streamKey === streamKey);
    if (index >= 0) {
      messages[index] = {
        ...messages[index],
        text: `${messages[index].text || ""}${payload.delta || ""}`,
        updatedAt: nowIso(),
      };
    } else {
      messages.push({
        id: streamKey,
        streamKey,
        role: kind === "assistant" ? "assistant" : "system",
        kind,
        turnId: payload.turnId || null,
        itemId: payload.itemId || null,
        text: payload.delta || "",
        createdAt: nowIso(),
      });
    }

    return this.patchTask(taskId, { messages });
  }

  bindChannel(channelBinding) {
    const key = `${channelBinding.channelType}:${channelBinding.channelId}`;
    const existing = this.state.channels[key];
    this.state.channels[key] = createChannelBinding({
      ...existing,
      ...channelBinding,
      createdAt: existing?.createdAt || channelBinding.createdAt,
      updatedAt: nowIso(),
    });
    this.scheduleSave();
    return createChannelBinding(this.state.channels[key]);
  }
}

class TaskStreamHub {
  constructor() {
    this.subscribers = new Map();
  }

  subscribe(taskId, response) {
    const bucket = this.subscribers.get(taskId) || new Set();
    bucket.add(response);
    this.subscribers.set(taskId, bucket);
  }

  unsubscribe(taskId, response) {
    const bucket = this.subscribers.get(taskId);
    if (!bucket) {
      return;
    }

    bucket.delete(response);
    if (bucket.size === 0) {
      this.subscribers.delete(taskId);
    }
  }

  publish(taskId, event, payload) {
    const bucket = this.subscribers.get(taskId);
    if (!bucket) {
      return;
    }

    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of bucket) {
      response.write(message);
    }
  }
}

class RealtimeSessionHub {
  constructor() {
    this.sessions = new Map();
    this.subscribers = new Map();
  }

  createSession(session) {
    const now = Date.now();
    const normalized = {
      id: String(session.id || `voice-${stableHash(`${now}-${Math.random()}`)}`),
      threadId: String(session.threadId || ""),
      createdAt: session.createdAt || nowIso(),
      updatedAt: nowIso(),
      expiresAt: now + REALTIME_SESSION_TTL_MS,
      transcript: "",
      answerSdp: "",
      lastError: "",
      closed: false,
      sdpWaiters: [],
    };
    this.sessions.set(normalized.id, normalized);
    return normalized;
  }

  getSession(sessionId) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) {
      return null;
    }
    if (Date.now() > Number(session.expiresAt || 0)) {
      this.closeSession(session.id, "expired");
      return null;
    }
    return session;
  }

  findSessionByThreadId(threadId) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) {
      return null;
    }
    for (const session of this.sessions.values()) {
      if (!session.closed && session.threadId === normalizedThreadId) {
        return session;
      }
    }
    return null;
  }

  waitForSdp(sessionId, timeoutMs = REALTIME_SDP_WAIT_MS) {
    const session = this.getSession(sessionId);
    if (!session) {
      return Promise.reject(new Error("Realtime session not found."));
    }
    if (session.answerSdp) {
      return Promise.resolve(session.answerSdp);
    }
    if (session.lastError) {
      return Promise.reject(new Error(session.lastError));
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          session.sdpWaiters = session.sdpWaiters.filter((entry) => entry !== waiter);
          reject(new Error(session.lastError || "Timed out waiting for realtime SDP answer."));
        }, timeoutMs),
      };
      session.sdpWaiters.push(waiter);
    });
  }

  applyNotification(method, params = {}) {
    const session = this.findSessionByThreadId(params.threadId);
    if (!session) {
      return false;
    }
    session.updatedAt = nowIso();

    if (method === "thread/realtime/sdp") {
      session.answerSdp = String(params.sdp || "");
      for (const waiter of session.sdpWaiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve(session.answerSdp);
      }
      this.publish(session.id, "sdp", { sessionId: session.id, threadId: session.threadId, sdp: session.answerSdp });
      return true;
    }

    if (method === "thread/realtime/transcript/delta") {
      const delta = String(params.delta || "");
      if (delta) {
        session.transcript = `${session.transcript || ""}${delta}`;
      }
      this.publish(session.id, "transcript.delta", {
        sessionId: session.id,
        threadId: session.threadId,
        role: String(params.role || ""),
        delta,
        transcript: session.transcript,
      });
      return true;
    }

    if (method === "thread/realtime/transcript/done") {
      const text = String(params.text || "");
      if (text && String(params.role || "") === "user") {
        session.transcript = text;
      }
      this.publish(session.id, "transcript.done", {
        sessionId: session.id,
        threadId: session.threadId,
        role: String(params.role || ""),
        text,
        transcript: session.transcript,
      });
      return true;
    }

    if (method === "thread/realtime/error") {
      this.publish(session.id, "error", {
        sessionId: session.id,
        threadId: session.threadId,
        message: normalizeRuntimeErrorMessage(params.message || "Realtime voice failed."),
      });
      return true;
    }

    if (method === "thread/realtime/closed") {
      this.closeSession(session.id, String(params.reason || "closed"));
      return true;
    }

    if (method === "thread/realtime/started") {
      this.publish(session.id, "started", {
        sessionId: session.id,
        threadId: session.threadId,
        codexSessionId: params.sessionId || null,
      });
      return true;
    }

    return method.startsWith("thread/realtime/");
  }

  failActiveSessions(reason = "Realtime voice failed.") {
    const message = normalizeRuntimeErrorMessage(reason || "Realtime voice failed.");
    for (const session of this.sessions.values()) {
      if (session.closed) {
        continue;
      }
      session.lastError = message;
      for (const waiter of session.sdpWaiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(message));
      }
      this.publish(session.id, "error", {
        sessionId: session.id,
        threadId: session.threadId,
        message,
      });
    }
  }

  subscribe(sessionId, response) {
    const bucket = this.subscribers.get(sessionId) || new Set();
    bucket.add(response);
    this.subscribers.set(sessionId, bucket);
  }

  unsubscribe(sessionId, response) {
    const bucket = this.subscribers.get(sessionId);
    if (!bucket) {
      return;
    }
    bucket.delete(response);
    if (bucket.size === 0) {
      this.subscribers.delete(sessionId);
    }
  }

  publish(sessionId, event, payload) {
    const bucket = this.subscribers.get(sessionId);
    if (!bucket) {
      return;
    }
    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of bucket) {
      response.write(message);
    }
  }

  closeSession(sessionId, reason = "closed") {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.closed = true;
    for (const waiter of session.sdpWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Realtime session closed: ${reason}`));
    }
    this.publish(sessionId, "closed", {
      sessionId,
      threadId: session.threadId,
      reason,
    });
  }
}

class OpenAgentDaemon {
  constructor() {
    ensureDir(OPENAGENT_HOME);
    this.config = this.ensureConfig();
    this.locator = new DesktopCodexLocator();
    this.store = new TaskStore(STATE_PATH);
    this.streamHub = new TaskStreamHub();
    this.realtimeHub = new RealtimeSessionHub();
    this.client = new CodexAppServerClient({
      binaryPath: this.locator.resolveEmbeddedCodexPath(),
      cwd: process.cwd(),
      onNotification: (notification) => this.handleRuntimeNotification(notification),
      onRuntimeError: (error) => this.handleRuntimeError(error),
    });
    this.lastRuntimeError = "";
    this.isShuttingDown = false;
    this.automationSchedulerTimer = null;
    this.automationRunInFlight = new Set();
  }

  ensureConfig() {
    const existing = readJson(CONFIG_PATH, null);
    const config = {
      host: String(existing?.host || DEFAULT_HOST),
      port: Number(existing?.port || DEFAULT_PORT),
      token: String(existing?.token || randomToken()),
      updatedAt: nowIso(),
    };
    writeJson(CONFIG_PATH, config);
    return config;
  }

  runtimeStatus() {
    const runtimeCheck = this.locator.validateRuntimeAvailable();
    return {
      daemon: {
        host: this.config.host,
        port: this.config.port,
      },
      runtime: runtimeCheck,
      lastRuntimeError: this.lastRuntimeError,
      automations: {
        count: this.store.getAutomations().length,
      },
    };
  }

  ensureAuthorized(request, response) {
    if (request.url === "/health") {
      return true;
    }

    const provided = request.headers["x-openagent-token"];
    if (provided !== this.config.token) {
      sendError(response, 401, "Unauthorized.");
      return false;
    }
    return true;
  }

  taskPayload(task, options = {}) {
    if (!task) {
      return null;
    }

    const includeMessages = options.includeMessages !== false;
    const messageSummary = buildTaskMessageSummary(task);
    return {
      ...task,
      ...messageSummary,
      messages: includeMessages ? (Array.isArray(task.messages) ? task.messages : []) : [],
      messagesIncluded: includeMessages,
      runtimeConfig: normalizeRuntimeConfig(task.runtimeConfig),
    };
  }

  publishTask(task) {
    if (!task) {
      return;
    }
    this.syncChannelBindingsForTask(task);
    this.streamHub.publish(task.taskId, "task.updated", {
      task: this.taskPayload(task),
    });
  }

  syncChannelBindingsForTask(task) {
    if (!task?.taskId) {
      return;
    }

    const channels = this.store.listChannelBindingsForTask(task.taskId);
    for (const channel of channels) {
      if (channel.threadId === task.threadId) {
        continue;
      }

      this.store.bindChannel({
        ...channel,
        threadId: task.threadId,
      });
    }
  }

  handleRuntimeError(error) {
    this.lastRuntimeError = normalizeRuntimeErrorMessage(error);
    if (this.lastRuntimeError.toLowerCase().includes("realtime")) {
      this.realtimeHub.failActiveSessions(this.lastRuntimeError);
    }
  }

  handleRuntimeNotification(notification) {
    const { method, params } = notification;
    if (this.realtimeHub.applyNotification(method, params)) {
      return;
    }

    const task = this.store.findTaskByThreadId(params?.threadId);
    const automation = task ? null : this.store.findAutomationByThreadId(params?.threadId);
    if (!task && !automation) {
      return;
    }

    if (automation) {
      this.handleAutomationRuntimeNotification(automation, method, params);
      return;
    }

    switch (method) {
      case "turn/started": {
        const nextTask = this.store.patchTask(task.taskId, {
          currentTurnId: params?.turn?.id || null,
          status: "running",
          lastError: "",
        });
        this.publishTask(nextTask);
        return;
      }

      case "turn/completed": {
        const nextTask = this.store.patchTask(task.taskId, {
          currentTurnId: null,
          status: "idle",
          lastError: "",
        });
        this.publishTask(nextTask);
        return;
      }

      case "item/agentMessage/delta": {
        const nextTask = this.store.appendDelta(task.taskId, "assistant", params);
        this.publishTask(nextTask);
        return;
      }

      case "item/toolCall/outputDelta":
      case "item/toolCall/output_delta":
      case "item/tool_call/outputDelta":
      case "item/tool_call/output_delta":
      case "item/commandExecution/outputDelta":
      case "item/command_execution/outputDelta":
      case "item/fileChange/outputDelta": {
        const nextTask = this.store.appendDelta(task.taskId, "tool", {
          ...params,
          delta: params?.delta || params?.outputDelta || params?.output || "",
        });
        this.publishTask(nextTask);
        return;
      }

      default:
        return;
    }
  }

  handleAutomationRuntimeNotification(automation, method, params) {
    switch (method) {
      case "turn/started": {
        this.store.patchAutomation(automation.automationId, {
          currentTurnId: params?.turn?.id || null,
          status: "running",
          lastError: "",
        });
        return;
      }

      case "turn/completed": {
        const completedAt = nowIso();
        this.store.patchAutomation(automation.automationId, {
          currentTurnId: null,
          status: "idle",
          lastError: "",
          lastRunAt: completedAt,
          nextRunAt: computeNextAutomationRunAt(automation.schedule, new Date(completedAt)),
        });
        const latestAutomation = this.store.getAutomation(automation.automationId);
        this.store.recordAutomationRunFinished(automation.automationId, {
          runId: latestAutomation?.activeRunId,
          status: "completed",
          completedAt,
          turnId: automation.currentTurnId,
          threadId: automation.threadId,
          report: latestAutomationAssistantText(latestAutomation),
        });
        this.automationRunInFlight.delete(automation.automationId);
        return;
      }

      case "item/agentMessage/delta": {
        this.store.appendAutomationDelta(automation.automationId, "assistant", params);
        return;
      }

      case "item/toolCall/outputDelta":
      case "item/toolCall/output_delta":
      case "item/tool_call/outputDelta":
      case "item/tool_call/output_delta":
      case "item/commandExecution/outputDelta":
      case "item/command_execution/outputDelta":
      case "item/fileChange/outputDelta": {
        this.store.appendAutomationDelta(automation.automationId, "tool", {
          ...params,
          delta: params?.delta || params?.outputDelta || params?.output || "",
        });
        return;
      }

      default:
        return;
    }
  }

  async startRealtimeVoiceSession(body = {}) {
    const offerSdp = String(body.offerSdp || "").trim();
    if (!offerSdp) {
      throw new Error("Voice Graph realtime mode requires a WebRTC SDP offer.");
    }
    const cwd = normalizeWorkingDirectory(body.cwd || process.cwd());
    const runtimeConfig = normalizeRuntimeConfig(body.runtimeConfig || DEFAULT_RUNTIME_CONFIG);
    const thread = await this.client.startThreadForRealtime({
      cwd,
      runtimeConfig,
      ephemeral: true,
    });
    const threadId = String(thread?.id || "").trim();
    if (!threadId) {
      throw new Error("Codex app-server did not return a realtime thread id.");
    }

    const session = this.realtimeHub.createSession({
      threadId,
    });
    const prompt = String(body.prompt || "").trim()
      || "You are OpenAgent Voice Graph. Transcribe and respond conversationally. Keep replies concise unless the user asks for detail.";

    try {
      await this.client.startRealtimeConversation({
        threadId,
        outputModality: String(body.outputModality || "text") === "audio" ? "audio" : "text",
        prompt,
        sessionId: session.id,
        transport: {
          type: "webrtc",
          sdp: offerSdp,
        },
        voice: body.voice || null,
      });
      const answerSdp = await this.realtimeHub.waitForSdp(session.id);
      return {
        sessionId: session.id,
        threadId,
        answerSdp,
      };
    } catch (error) {
      this.realtimeHub.closeSession(session.id, String(error?.message || error));
      throw error;
    }
  }

  async appendRealtimeVoiceAudio(sessionId, body = {}) {
    const session = this.realtimeHub.getSession(sessionId);
    if (!session) {
      throw new Error("Realtime session not found.");
    }
    const data = String(body?.audio?.data || body?.data || "").trim();
    if (!data) {
      return { appended: false };
    }
    await this.client.appendRealtimeAudio(session.threadId, {
      data,
      sampleRate: Number(body?.audio?.sampleRate || body?.sampleRate || 24_000),
      numChannels: Number(body?.audio?.numChannels || body?.numChannels || 1),
      samplesPerChannel: Number(body?.audio?.samplesPerChannel || body?.samplesPerChannel || 0) || null,
      itemId: body?.audio?.itemId || body?.itemId || null,
    });
    return { appended: true };
  }

  async stopRealtimeVoiceSession(sessionId) {
    const session = this.realtimeHub.getSession(sessionId);
    if (!session) {
      return { stopped: false };
    }
    try {
      await this.client.stopRealtimeConversation(session.threadId);
    } finally {
      this.realtimeHub.closeSession(session.id, "stopped");
    }
    return { stopped: true };
  }

  buildCanvasBinding(selectionContext, existingBinding = {}, overrides = {}) {
    const existingActiveSourceNodeId = String(existingBinding.activeSourceNodeId || "").trim();
    const overrideActiveSourceNodeId = String(overrides.activeSourceNodeId || "").trim();
    const nextActiveSourceNodeId = String(
      overrideActiveSourceNodeId
      || existingActiveSourceNodeId
      || (Array.isArray(selectionContext?.nodeIds) && selectionContext.nodeIds.length === 1 ? selectionContext.nodeIds[0] : "")
    ).trim();
    const shouldRefreshActiveSourceTimestamp = Boolean(
      nextActiveSourceNodeId
      && (
        !String(existingBinding.activeSourceUpdatedAt || "").trim()
        || (overrideActiveSourceNodeId && overrideActiveSourceNodeId !== existingActiveSourceNodeId)
      )
    );

    return normalizeCanvasBinding({
      ...existingBinding,
      ...overrides,
      canvasPath: String(overrides.canvasPath || existingBinding.canvasPath || selectionContext?.canvasPath || "").trim(),
      rootNodeIds: Array.isArray(overrides.rootNodeIds)
        ? overrides.rootNodeIds
        : (Array.isArray(existingBinding.rootNodeIds) && existingBinding.rootNodeIds.length > 0
          ? existingBinding.rootNodeIds
          : selectionContext?.nodeIds),
      activeSourceNodeId: nextActiveSourceNodeId,
      activeSourceUpdatedAt: String(
        overrides.activeSourceUpdatedAt
        || (shouldRefreshActiveSourceTimestamp ? nowIso() : existingBinding.activeSourceUpdatedAt)
        || ""
      ).trim(),
      resultNodesBySourceNodeId: {
        ...((existingBinding?.resultNodesBySourceNodeId && typeof existingBinding.resultNodesBySourceNodeId === "object")
          ? existingBinding.resultNodesBySourceNodeId
          : {}),
        ...((overrides?.resultNodesBySourceNodeId && typeof overrides.resultNodesBySourceNodeId === "object")
          ? overrides.resultNodesBySourceNodeId
          : {}),
      },
    }, selectionContext);
  }

  createOrReuseTaskFromCanvasSelection(body) {
    const selectionContext = normalizeCanvasSelection(body);
    const runtimeConfig = normalizeRuntimeConfig(body.runtimeConfig);
    if (!selectionContext.canvasPath || selectionContext.nodeIds.length === 0) {
      throw new Error("A canvasPath and at least one selected node are required.");
    }

    const selectionKey = createSelectionKey(selectionContext);
    const normalizedCwd = normalizeWorkingDirectory(body.cwd);
    const forceNewTask = body.forceNewTask === true;

    if (forceNewTask) {
      const taskId = normalizedCwd
        ? createFreshTaskId(selectionKey, normalizedCwd)
        : createFreshPendingTaskId(selectionKey);

      return this.store.upsertTask(createTaskBinding({
        taskId,
        source: "obsidian-canvas",
        sourceRef: selectionContext.canvasPath,
        cwd: normalizedCwd,
        status: normalizedCwd ? "idle" : "needs-cwd",
        title: selectionContext.title,
        selectionContext,
        threadId: null,
        currentTurnId: null,
        lastError: "",
        messages: [],
        runtimeConfig,
        canvasBinding: this.buildCanvasBinding(selectionContext),
      }));
    }

    if (!normalizedCwd) {
      const existing = this.store.findMostRecentTaskForSelection(selectionKey);
      if (existing) {
        const refreshed = this.store.patchTask(existing.taskId, {
          title: selectionContext.title,
          source: "obsidian-canvas",
          sourceRef: selectionContext.canvasPath,
          selectionContext,
          runtimeConfig,
          lastError: existing.lastError || "",
          canvasBinding: this.buildCanvasBinding(selectionContext, existing.canvasBinding),
        });
        return refreshed;
      }

      return this.store.upsertTask(createTaskBinding({
        taskId: createPendingTaskId(selectionKey),
        source: "obsidian-canvas",
        sourceRef: selectionContext.canvasPath,
        cwd: "",
        status: "needs-cwd",
        title: selectionContext.title,
        selectionContext,
        runtimeConfig,
        canvasBinding: this.buildCanvasBinding(selectionContext),
      }));
    }

    const taskId = createTaskId(selectionKey, normalizedCwd);
    const existing = this.store.getTask(taskId);
    if (existing) {
      return this.store.patchTask(taskId, {
        title: selectionContext.title,
        source: "obsidian-canvas",
        sourceRef: selectionContext.canvasPath,
        cwd: normalizedCwd,
        selectionContext,
        runtimeConfig,
        status: existing.threadId ? existing.status : "idle",
        canvasBinding: this.buildCanvasBinding(selectionContext, existing.canvasBinding),
      });
    }

    const pendingId = createPendingTaskId(selectionKey);
    const pending = this.store.getTask(pendingId);
    const baseTask = pending || createTaskBinding({
      source: "obsidian-canvas",
      sourceRef: selectionContext.canvasPath,
      cwd: normalizedCwd,
      status: "idle",
      title: selectionContext.title,
      selectionContext,
      runtimeConfig,
      canvasBinding: this.buildCanvasBinding(selectionContext),
    });

    const nextTask = createTaskBinding({
      ...baseTask,
      taskId,
      cwd: normalizedCwd,
      status: "idle",
      threadId: null,
      currentTurnId: null,
      lastError: "",
      messages: [],
      runtimeConfig,
      selectionContext,
      canvasBinding: this.buildCanvasBinding(selectionContext, baseTask.canvasBinding),
    });

    return this.store.upsertTask(nextTask);
  }

  updateTaskCanvasBinding(taskId, body = {}) {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    const currentBinding = normalizeCanvasBinding(task.canvasBinding, task.selectionContext);
    const nextResultNodesBySourceNodeId = {
      ...currentBinding.resultNodesBySourceNodeId,
    };

    if (body.resultNode && typeof body.resultNode === "object") {
      const sourceNodeId = String(body.resultNode.sourceNodeId || "").trim();
      const resultNodeId = String(body.resultNode.resultNodeId || "").trim();
      if (!sourceNodeId || !resultNodeId) {
        throw new Error("Result node updates require sourceNodeId and resultNodeId.");
      }

      nextResultNodesBySourceNodeId[sourceNodeId] = {
        sourceNodeId,
        resultNodeId,
        edgeId: String(body.resultNode.edgeId || "").trim(),
        messageId: String(body.resultNode.messageId || "").trim(),
        syncSignature: String(body.resultNode.syncSignature || "").trim(),
        updatedAt: nowIso(),
      };
    }

    const nextTask = this.store.patchTask(taskId, {
      canvasBinding: this.buildCanvasBinding(task.selectionContext, currentBinding, {
        canvasPath: body.canvasPath,
        rootNodeIds: body.rootNodeIds,
        activeSourceNodeId: body.activeSourceNodeId,
        resultNodesBySourceNodeId: nextResultNodesBySourceNodeId,
      }),
    });
    this.publishTask(nextTask);
    return nextTask;
  }

  buildForkedTaskMessages(sourceTask, branchMessageId = "") {
    const messages = Array.isArray(sourceTask?.messages) ? sourceTask.messages : [];
    const normalizedBranchMessageId = String(branchMessageId || "").trim();
    if (!normalizedBranchMessageId) {
      return [...messages];
    }

    const branchMessageIndex = messages.findIndex((message) => {
      return String(message?.id || message?.streamKey || "").trim() === normalizedBranchMessageId;
    });
    if (branchMessageIndex < 0) {
      return [...messages];
    }

    return messages.slice(0, branchMessageIndex + 1);
  }

  async forkTaskFromCanvasSelection(sourceTaskId, body = {}) {
    const sourceTask = this.store.getTask(sourceTaskId);
    if (!sourceTask) {
      throw new Error("Source task not found.");
    }
    if (!sourceTask.threadId) {
      throw new Error("The source task does not have a Codex thread to fork.");
    }

    const selectionContext = normalizeCanvasSelection(body.selectionContext || body);
    if (!selectionContext.canvasPath || selectionContext.nodeIds.length === 0) {
      throw new Error("A canvasPath and at least one selected node are required.");
    }

    const requestedCwd = normalizeWorkingDirectory(body.cwd || sourceTask.cwd);
    if (!requestedCwd) {
      throw new Error("Set a working directory before forking.");
    }

    const runtimeConfig = normalizeRuntimeConfig(body.runtimeConfig || sourceTask.runtimeConfig);
    const selectionKey = createSelectionKey(selectionContext);
    const taskId = createFreshTaskId(selectionKey, requestedCwd);
    const selectedSourceNodeId = String(selectionContext.nodeIds[0] || "").trim();
    const branchRootNodeId = String(body.branchSourceNodeId || "").trim() || selectedSourceNodeId;
    const forkedMessages = this.buildForkedTaskMessages(sourceTask, body.branchMessageId);

    let nextTask = this.store.upsertTask(createTaskBinding({
      taskId,
      source: "obsidian-canvas",
      sourceRef: selectionContext.canvasPath,
      cwd: requestedCwd,
      status: "starting",
      title: selectionContext.title,
      selectionContext,
      threadId: null,
      currentTurnId: null,
      lastError: "",
      messages: forkedMessages,
      runtimeConfig,
      canvasBinding: this.buildCanvasBinding(selectionContext, sourceTask.canvasBinding, {
        canvasPath: selectionContext.canvasPath,
        rootNodeIds: branchRootNodeId ? [branchRootNodeId] : selectionContext.nodeIds,
        activeSourceNodeId: selectedSourceNodeId,
      }),
    }));
    this.publishTask(nextTask);

    try {
      await this.ensureRuntimeReady();
      const thread = await this.client.forkThread(sourceTask, runtimeConfig, {
        rollbackTurns: body.rollbackTurns,
      });
      nextTask = this.store.patchTask(taskId, {
        threadId: thread?.id || null,
        status: "idle",
      });
      this.publishTask(nextTask);

      const rawPrompt = String(body.rawPrompt || body.message || "");
      return this.runTask(taskId, {
        rawPrompt,
        transcriptMessage: String(body.transcriptMessage || body.message || rawPrompt || ""),
        forceContext: body.forceContext !== false,
        selectionContext,
        runtimeConfig,
      });
    } catch (error) {
      nextTask = this.store.patchTask(taskId, {
        currentTurnId: null,
        status: "error",
        lastError: String(error?.message || error),
      });
      this.publishTask(nextTask);
      throw error;
    }
  }

  async ensureRuntimeReady() {
    const runtimeCheck = this.locator.validateRuntimeAvailable();
    if (!runtimeCheck.ok) {
      throw new Error(runtimeCheck.message);
    }

    if (this.client.binaryPath !== runtimeCheck.binaryPath) {
      this.client.stop();
      this.client.binaryPath = runtimeCheck.binaryPath;
    }

    await this.client.start();
    this.lastRuntimeError = "";
  }

  async runTask(taskId, options = {}) {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }
    if (!task.cwd) {
      throw new Error("Set a working directory before the first run.");
    }

    const normalizedCwd = normalizeWorkingDirectory(task.cwd);
    if (normalizedCwd !== task.cwd) {
      this.store.patchTask(task.taskId, { cwd: normalizedCwd });
    }

    const turnSelectionContext = options.selectionContext
      ? normalizeCanvasSelection(options.selectionContext)
      : task.selectionContext;
    const rawPrompt = String(options.rawPrompt || "");
    const prompt = rawPrompt || buildCanvasPrompt(turnSelectionContext, options.message || "", {
      cwd: task.cwd,
      forceContext: options.forceContext !== false,
    });
    const inputItems = buildTurnInputItems(turnSelectionContext, prompt, task.cwd);
    if (inputItems.length === 0) {
      throw new Error("Nothing to send.");
    }

    const transcriptMessage = String(options.transcriptMessage || options.message || rawPrompt).trim()
      || "";
    const runtimeConfig = normalizeRuntimeConfig(options.runtimeConfig || task.runtimeConfig);
    if (transcriptMessage) {
      this.store.appendMessage(task.taskId, {
        id: `user:${Date.now()}`,
        role: "user",
        kind: "chat",
        text: transcriptMessage,
      });
    }

    let nextTask = this.store.patchTask(task.taskId, {
      status: "starting",
      lastError: "",
      runtimeConfig,
    });
    this.publishTask(nextTask);

    try {
      await this.ensureRuntimeReady();
      const runnableTask = this.store.patchTask(nextTask.taskId, {
        cwd: normalizedCwd,
        runtimeConfig,
      });
      const thread = await this.client.createOrResumeThread(runnableTask, runtimeConfig);
      nextTask = this.store.patchTask(nextTask.taskId, {
        threadId: thread?.id || nextTask.threadId,
        status: "idle",
        cwd: normalizedCwd,
        runtimeConfig,
      });
      const turn = await this.client.sendTurn(nextTask, inputItems, runtimeConfig);
      nextTask = this.store.patchTask(nextTask.taskId, {
        currentTurnId: turn?.id || null,
        status: "running",
        runtimeConfig,
      });
      this.publishTask(nextTask);
      return nextTask;
    } catch (error) {
      nextTask = this.store.patchTask(nextTask.taskId, {
        currentTurnId: null,
        status: "error",
        lastError: String(error?.message || error),
      });
      this.publishTask(nextTask);
      throw error;
    }
  }

  async interruptTask(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    await this.ensureRuntimeReady();
    await this.client.interrupt(task);
    const nextTask = this.store.patchTask(taskId, {
      currentTurnId: null,
      status: "idle",
    });
    this.store.appendMessage(taskId, {
      id: `system:${Date.now()}`,
      role: "system",
      kind: "status",
      text: "Turn interrupted.",
    });
    this.publishTask(this.store.getTask(taskId));
    return nextTask;
  }

  automationPayload(automation, options = {}) {
    if (!automation) {
      return null;
    }

    const includeMessages = options.includeMessages !== false;
    return {
      ...automation,
      nextRunAtDisplay: formatAutomationTimestamp(automation.nextRunAt),
      lastRunAtDisplay: formatAutomationTimestamp(automation.lastRunAt),
      lastAssistantReport: latestAutomationAssistantText(automation),
      messages: includeMessages ? (Array.isArray(automation.messages) ? automation.messages : []) : [],
      messagesIncluded: includeMessages,
      runtimeConfig: normalizeRuntimeConfig(automation.runtimeConfig),
    };
  }

  syncAutomations(body = {}) {
    const synced = this.store.syncAutomations(body.automations || [], {
      source: body.source || "vault",
      pruneMissing: body.pruneMissing !== false,
    });
    return synced;
  }

  async runAutomation(automationId, options = {}) {
    const automation = this.store.getAutomation(automationId);
    if (!automation) {
      throw new Error("Automation not found.");
    }
    if (!automation.enabled && options.force !== true) {
      throw new Error("Automation is disabled.");
    }
    if (automation.status === "running" || automation.status === "starting" || this.automationRunInFlight.has(automation.automationId)) {
      return automation;
    }
    if (!String(automation.cwd || "").trim()) {
      throw new Error("Automation requires a working directory.");
    }
    if (!String(automation.prompt || "").trim()) {
      throw new Error("Automation prompt is empty.");
    }

    const normalizedCwd = normalizeWorkingDirectory(automation.cwd);
    const runtimeConfig = normalizeRuntimeConfig(automation.runtimeConfig);
    this.automationRunInFlight.add(automation.automationId);

    let nextAutomation = this.store.patchAutomation(automation.automationId, {
      cwd: normalizedCwd,
      status: "starting",
      lastError: "",
      runtimeConfig,
    });

    try {
      await this.ensureRuntimeReady();
      const runnable = {
        taskId: automation.automationId,
        cwd: normalizedCwd,
        threadId: automation.threadStrategy === "resume" ? automation.threadId : null,
      };
      const thread = await this.client.createOrResumeThread(runnable, runtimeConfig);
      nextAutomation = this.store.patchAutomation(automation.automationId, {
        threadId: thread?.id || nextAutomation.threadId,
        status: "idle",
      });
      const turn = await this.client.sendTurn({
        taskId: automation.automationId,
        cwd: normalizedCwd,
        threadId: nextAutomation.threadId,
      }, [
        {
          type: "text",
          text: automation.prompt,
          text_elements: [],
        },
      ], runtimeConfig);
      const startedAt = nowIso();
      const runId = `run:${automation.automationId}:${Date.now()}`;
      this.store.recordAutomationRunStarted(automation.automationId, {
        runId,
        startedAt,
        threadId: nextAutomation.threadId,
        turnId: turn?.id || null,
      });
      nextAutomation = this.store.patchAutomation(automation.automationId, {
        currentTurnId: turn?.id || null,
        status: "running",
      });
      return nextAutomation;
    } catch (error) {
      this.automationRunInFlight.delete(automation.automationId);
      const completedAt = nowIso();
      const errorMessage = String(error?.message || error);
      this.store.recordAutomationRunFinished(automation.automationId, {
        status: "failed",
        completedAt,
        error: errorMessage,
      });
      nextAutomation = this.store.patchAutomation(automation.automationId, {
        currentTurnId: null,
        status: "error",
        lastError: errorMessage,
        nextRunAt: computeNextAutomationRunAt(automation.schedule),
      });
      throw error;
    }
  }

  async runDueAutomations() {
    const dueAutomations = this.store.listDueAutomations();
    for (const automation of dueAutomations) {
      void this.runAutomation(automation.automationId).catch((error) => {
        const errorMessage = String(error?.message || error);
        this.store.patchAutomation(automation.automationId, {
          currentTurnId: null,
          status: "error",
          lastError: errorMessage,
          nextRunAt: computeNextAutomationRunAt(automation.schedule),
        });
      });
    }
  }

  startAutomationScheduler() {
    if (this.automationSchedulerTimer) {
      return;
    }

    this.automationSchedulerTimer = setInterval(() => {
      void this.runDueAutomations();
    }, AUTOMATION_SCHEDULER_INTERVAL_MS);
    if (typeof this.automationSchedulerTimer?.unref === "function") {
      this.automationSchedulerTimer.unref();
    }
    void this.runDueAutomations();
  }

  stopAutomationScheduler() {
    if (!this.automationSchedulerTimer) {
      return;
    }
    clearInterval(this.automationSchedulerTimer);
    this.automationSchedulerTimer = null;
  }

  bindXmtpConversation(conversationId, body) {
    const taskId = String(body.taskId || "").trim();
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    const channel = createChannelBinding({
      channelType: "xmtp",
      channelId: conversationId,
      taskId: task.taskId,
      threadId: task.threadId,
    });

    return this.store.bindChannel(channel);
  }

  buildXmtpSelectionContext(conversationId, body = {}) {
    const normalizedConversationId = String(conversationId || "").trim();
    if (!normalizedConversationId) {
      throw new Error("Conversation id is required.");
    }

    const shortId = normalizedConversationId.slice(0, 8);
    const title = String(body.title || "").trim() || `XMTP ${shortId}`;
    return normalizeCanvasSelection({
      canvasPath: `xmtp://${normalizedConversationId}`,
      canvasName: "XMTP",
      nodeIds: [normalizedConversationId],
      textBlocks: [],
      markdownFiles: [],
      warnings: [],
      title,
    });
  }

  getXmtpConversationBinding(conversationId) {
    const normalizedConversationId = String(conversationId || "").trim();
    if (!normalizedConversationId) {
      throw new Error("Conversation id is required.");
    }

    const channel = this.store.getChannelBinding("xmtp", normalizedConversationId);
    const task = channel ? this.store.getTask(channel.taskId) : null;
    return {
      channel,
      task,
    };
  }

  createOrReuseTaskFromXmtpConversation(conversationId, body = {}) {
    const normalizedConversationId = String(conversationId || "").trim();
    if (!normalizedConversationId) {
      throw new Error("Conversation id is required.");
    }

    const existingBinding = this.getXmtpConversationBinding(normalizedConversationId);
    const existingTask = existingBinding.task;
    const requestedCwd = normalizeWorkingDirectory(body.cwd || existingTask?.cwd || "");
    if (!requestedCwd) {
      throw new Error("Working directory is required for XMTP control.");
    }

    const forceNewTask = body.forceNewTask === true;
    const runtimeConfig = normalizeRuntimeConfig(body.runtimeConfig || existingTask?.runtimeConfig);
    const selectionContext = this.buildXmtpSelectionContext(normalizedConversationId, body);
    const sourceRef = selectionContext.canvasPath;
    const selectionKey = createSelectionKey(selectionContext);

    let task = null;

    if (!forceNewTask && existingTask && existingTask.cwd === requestedCwd) {
      task = this.store.patchTask(existingTask.taskId, {
        cwd: requestedCwd,
        title: selectionContext.title,
        source: "xmtp",
        sourceRef,
        selectionContext,
        runtimeConfig,
        canvasBinding: this.buildCanvasBinding(selectionContext, existingTask.canvasBinding, {
          activeSourceNodeId: normalizedConversationId,
        }),
      });
    } else if (!forceNewTask) {
      const stableTaskId = createTaskId(selectionKey, requestedCwd);
      const stableTask = this.store.getTask(stableTaskId);
      if (stableTask) {
        task = this.store.patchTask(stableTask.taskId, {
          cwd: requestedCwd,
          title: selectionContext.title,
          source: "xmtp",
          sourceRef,
          selectionContext,
          runtimeConfig,
          canvasBinding: this.buildCanvasBinding(selectionContext, stableTask.canvasBinding, {
            activeSourceNodeId: normalizedConversationId,
          }),
        });
      }
    }

    if (!task) {
      const taskId = forceNewTask
        ? createFreshTaskId(selectionKey, requestedCwd)
        : createTaskId(selectionKey, requestedCwd);
      task = this.store.upsertTask(createTaskBinding({
        taskId,
        source: "xmtp",
        sourceRef,
        cwd: requestedCwd,
        status: "idle",
        title: selectionContext.title,
        selectionContext,
        threadId: null,
        currentTurnId: null,
        lastError: "",
        messages: [],
        runtimeConfig,
        canvasBinding: this.buildCanvasBinding(selectionContext, {}, {
          activeSourceNodeId: normalizedConversationId,
        }),
      }));
    }

    const channel = this.store.bindChannel(createChannelBinding({
      channelType: "xmtp",
      channelId: normalizedConversationId,
      taskId: task.taskId,
      threadId: task.threadId,
    }));

    return {
      channel,
      task,
    };
  }

  async handleRequest(request, response) {
    if (!this.ensureAuthorized(request, response)) {
      return;
    }

    const url = new URL(request.url, `http://${this.config.host}:${this.config.port}`);
    const pathname = url.pathname;

    try {
      if (request.method === "GET" && pathname === "/health") {
        sendJson(response, 200, this.runtimeStatus());
        return;
      }

      if (request.method === "GET" && pathname === "/tasks") {
        sendJson(response, 200, {
          tasks: this.store.getTasks().map((task) => this.taskPayload(task, { includeMessages: false })),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/automations") {
        sendJson(response, 200, {
          automations: this.store.getAutomations().map((automation) => this.automationPayload(automation, { includeMessages: false })),
        });
        return;
      }

      if (request.method === "PUT" && pathname === "/automations/sync") {
        const body = await readRequestBody(request);
        const synced = this.syncAutomations(body);
        sendJson(response, 200, {
          automations: synced.map((automation) => this.automationPayload(automation, { includeMessages: false })),
        });
        return;
      }

      if (request.method === "POST" && /^\/automations\/[^/]+\/run$/.test(pathname)) {
        const body = await readRequestBody(request);
        const automation = await this.runAutomation(parseAutomationId(pathname), {
          force: body.force === true,
        });
        sendJson(response, 200, { automation: this.automationPayload(automation) });
        return;
      }

      if (request.method === "GET" && /^\/automations\/[^/]+$/.test(pathname)) {
        const automation = this.store.getAutomation(parseAutomationId(pathname));
        if (!automation) {
          sendError(response, 404, "Automation not found.");
          return;
        }
        sendJson(response, 200, { automation: this.automationPayload(automation) });
        return;
      }

      if (request.method === "GET" && /^\/tasks\/[^/]+$/.test(pathname)) {
        const task = this.store.getTask(parseTaskId(pathname));
        if (!task) {
          sendError(response, 404, "Task not found.");
          return;
        }
        sendJson(response, 200, { task: this.taskPayload(task) });
        return;
      }

      if (request.method === "GET" && /^\/tasks\/[^/]+\/stream$/.test(pathname)) {
        const taskId = parseTaskId(pathname);
        if (!this.store.getTask(taskId)) {
          sendError(response, 404, "Task not found.");
          return;
        }

        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        response.write("event: ready\ndata: {}\n\n");
        this.streamHub.subscribe(taskId, response);
        request.on("close", () => this.streamHub.unsubscribe(taskId, response));
        return;
      }

      if (request.method === "POST" && pathname === "/voice/realtime/start") {
        const body = await readRequestBody(request);
        const session = await this.startRealtimeVoiceSession(body);
        sendJson(response, 200, session);
        return;
      }

      if (request.method === "POST" && /^\/voice\/realtime\/[^/]+\/audio$/.test(pathname)) {
        const body = await readRequestBody(request);
        const sessionId = decodeURIComponent(pathname.split("/")[3] || "");
        const result = await this.appendRealtimeVoiceAudio(sessionId, body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && /^\/voice\/realtime\/[^/]+\/stop$/.test(pathname)) {
        const sessionId = decodeURIComponent(pathname.split("/")[3] || "");
        const result = await this.stopRealtimeVoiceSession(sessionId);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && /^\/voice\/realtime\/[^/]+\/stream$/.test(pathname)) {
        const sessionId = decodeURIComponent(pathname.split("/")[3] || "");
        const session = this.realtimeHub.getSession(sessionId);
        if (!session) {
          sendError(response, 404, "Realtime session not found.");
          return;
        }

        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        response.write(`event: ready\ndata: ${JSON.stringify({
          sessionId: session.id,
          threadId: session.threadId,
          transcript: session.transcript,
        })}\n\n`);
        this.realtimeHub.subscribe(sessionId, response);
        request.on("close", () => this.realtimeHub.unsubscribe(sessionId, response));
        return;
      }

      if (request.method === "POST" && pathname === "/tasks/from-canvas-selection") {
        const body = await readRequestBody(request);
        const task = this.createOrReuseTaskFromCanvasSelection(body);
        this.publishTask(task);
        sendJson(response, 200, { task: this.taskPayload(task) });
        return;
      }

      if (request.method === "POST" && /^\/tasks\/[^/]+\/run$/.test(pathname)) {
        const body = await readRequestBody(request);
        const task = await this.runTask(parseTaskId(pathname), {
          message: body.message || "",
          rawPrompt: body.rawPrompt || "",
          transcriptMessage: body.transcriptMessage || "",
          forceContext: body.forceContext !== false,
          selectionContext: body.selectionContext || null,
          runtimeConfig: body.runtimeConfig || {},
        });
        sendJson(response, 200, { task: this.taskPayload(task) });
        return;
      }

      if (request.method === "POST" && /^\/tasks\/[^/]+\/fork$/.test(pathname)) {
        const body = await readRequestBody(request);
        const task = await this.forkTaskFromCanvasSelection(parseTaskId(pathname), body);
        sendJson(response, 200, { task: this.taskPayload(task) });
        return;
      }

      if (request.method === "POST" && /^\/tasks\/[^/]+\/messages$/.test(pathname)) {
        const body = await readRequestBody(request);
        const task = await this.runTask(parseTaskId(pathname), {
          message: String(body.text || ""),
          forceContext: false,
          runtimeConfig: body.runtimeConfig || {},
        });
        sendJson(response, 200, { task: this.taskPayload(task) });
        return;
      }

      if (request.method === "PATCH" && /^\/tasks\/[^/]+\/canvas-binding$/.test(pathname)) {
        const body = await readRequestBody(request);
        const task = this.updateTaskCanvasBinding(parseTaskId(pathname), body);
        sendJson(response, 200, { task: this.taskPayload(task) });
        return;
      }

      if (request.method === "POST" && /^\/tasks\/[^/]+\/interrupt$/.test(pathname)) {
        const task = await this.interruptTask(parseTaskId(pathname));
        sendJson(response, 200, { task: this.taskPayload(task) });
        return;
      }

      if (request.method === "POST" && /^\/channels\/xmtp\/[^/]+\/bind$/.test(pathname)) {
        const body = await readRequestBody(request);
        const conversationId = decodeURIComponent(pathname.split("/")[3] || "");
        const channel = this.bindXmtpConversation(conversationId, body);
        sendJson(response, 200, { channel });
        return;
      }

      if (request.method === "GET" && /^\/channels\/xmtp\/[^/]+$/.test(pathname)) {
        const conversationId = decodeURIComponent(pathname.split("/")[3] || "");
        const binding = this.getXmtpConversationBinding(conversationId);
        sendJson(response, 200, {
          channel: binding.channel,
          task: this.taskPayload(binding.task),
        });
        return;
      }

      if (request.method === "POST" && /^\/channels\/xmtp\/[^/]+\/task$/.test(pathname)) {
        const body = await readRequestBody(request);
        const conversationId = decodeURIComponent(pathname.split("/")[3] || "");
        const binding = this.createOrReuseTaskFromXmtpConversation(conversationId, body);
        sendJson(response, 200, {
          channel: binding.channel,
          task: this.taskPayload(binding.task),
        });
        return;
      }

      sendError(response, 404, "Route not found.");
    } catch (error) {
      sendError(response, 400, String(error?.message || error));
    }
  }

  listen() {
    const server = http.createServer((request, response) => {
      this.handleRequest(request, response);
    });

    const shutdown = () => {
      if (this.isShuttingDown) {
        return;
      }

      this.isShuttingDown = true;
      this.stopAutomationScheduler();
      this.client.stop();
      this.store.save();
    };

    server.on("close", shutdown);

    const shutdownAndExit = () => {
      shutdown();
      server.close(() => process.exit(0));
      const forceExitTimer = setTimeout(() => process.exit(0), 1_000);
      if (typeof forceExitTimer?.unref === "function") {
        forceExitTimer.unref();
      }
    };

    process.once("beforeExit", shutdown);
    process.once("SIGINT", shutdownAndExit);
    process.once("SIGTERM", shutdownAndExit);

    server.listen(this.config.port, this.config.host, () => {
      console.log(`[openagent] daemon listening on http://${this.config.host}:${this.config.port}`);
      console.log(`[openagent] config file: ${CONFIG_PATH}`);
      this.startAutomationScheduler();
    });

    return server;
  }
}

if (require.main === module) {
  const daemon = new OpenAgentDaemon();
  daemon.listen();
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_HOST,
  DEFAULT_PORT,
  OPENAGENT_HOME,
  OpenAgentDaemon,
};
