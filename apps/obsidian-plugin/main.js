"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  ButtonComponent,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TextComponent,
  TFile,
} = require("obsidian");

const VIEW_TYPE = "openagent-view";
const DAEMON_CONFIG_PATH = path.join(os.homedir(), ".openagent", "daemon-config.json");
const DAEMON_LOG_PATH = path.join(os.homedir(), ".openagent", "daemon.log");
const PLUGIN_LOGO_FILE_NAME = "logo.png";
const PLUGIN_LOGO_PATH = path.join(__dirname, PLUGIN_LOGO_FILE_NAME);
const DEFAULT_SETTINGS = Object.freeze({
  daemonLaunchCommand: "",
  daemonLaunchCwd: "",
  daemonSandboxMode: "workspace-write",
  enableDebugLogging: false,
  enableDevSmokeRequests: false,
  workspaceRoot: "Workspaces",
});
const DAEMON_SANDBOX_MODE_OPTIONS = Object.freeze({
  WORKSPACE_WRITE: "workspace-write",
  DANGER_FULL_ACCESS: "danger-full-access",
});
const RECENT_SELECTION_TTL_MS = 15_000;
const SELECTION_SNAPSHOT_POLL_MS = 250;
const DEV_SMOKE_REQUEST_RELATIVE_PATH = path.join(".openagent", "smoke-request.json");
const DEV_SMOKE_RESULT_RELATIVE_PATH = path.join(".openagent", "smoke-result.json");
const DEBUG_LOG_RELATIVE_PATH = path.join(".openagent", "new-thread-debug.jsonl");
const DEV_SMOKE_POLL_MS = 1_000;
const MAX_DEBUG_EVENTS = 30;
const DAEMON_STATUS_POLL_MS = 10_000;
const RESULT_NODE_Y_GAP = 40;
const RESULT_NODE_MIN_HEIGHT = 160;
const RESULT_NODE_MAX_HEIGHT = 520;
const RESULT_NODE_DEFAULT_WIDTH = 420;
const RESULT_NODE_MIN_WIDTH = 320;
const RESULT_NODE_MAX_WIDTH = 720;
const RESULT_NODE_CHARS_PER_LINE = 52;
const FOLLOW_UP_NODE_DEFAULT_HEIGHT = 120;
const CANVAS_LAYOUT_BASE_X = 80;
const CANVAS_LAYOUT_BASE_Y = 80;
const CANVAS_LAYOUT_X_GAP = 180;
const CANVAS_LAYOUT_Y_GAP = 80;
const CANVAS_LAYOUT_COMPONENT_GAP = 220;
const CANVAS_LAYOUT_MIN_WIDTH = 260;
const CANVAS_LAYOUT_MIN_HEIGHT = 120;
const RUNNING_CANVAS_NODE_COLOR = "3";
const COMPLETED_CANVAS_NODE_COLOR = "#086ddd";
const AUTO_RUN_TRIGGER_CANVAS_NODE_COLORS = Object.freeze([
  "4",
  "#22c55e",
  "#16a34a",
  "#008000",
]);
const OPENAGENT_CANVAS_SCHEMA_VERSION = 1;
const CHAT_MESSAGE_PAGE_SIZE = 20;
const SETTINGS_RECENT_TASKS_PAGE_SIZE = 10;
const PANEL_TAB_OPTIONS = Object.freeze({
  ACTIVE_TASK: "active-task",
  WORKSPACE_SETTINGS: "workspace-settings",
  TASK_LIST: "task-list",
  ARCHIVED_TASK_LIST: "archived-task-list",
  DEBUG: "debug",
});
const DAEMON_CONNECTION_STATES = Object.freeze({
  UNKNOWN: "unknown",
  CHECKING: "checking",
  ONLINE: "online",
  OFFLINE: "offline",
});

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shellEscape(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function slugifyWorkspaceName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "workspace";
}

function joinVaultPath(...parts) {
  return parts
    .map((part) => String(part || "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function dirnameVaultPath(value) {
  const normalized = String(value || "").replace(/^\/+|\/+$/g, "");
  if (!normalized || !normalized.includes("/")) {
    return "";
  }
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

function normalizePanelTab(value) {
  if (value === PANEL_TAB_OPTIONS.WORKSPACE_SETTINGS) {
    return PANEL_TAB_OPTIONS.WORKSPACE_SETTINGS;
  }
  return value === PANEL_TAB_OPTIONS.ACTIVE_TASK
    ? PANEL_TAB_OPTIONS.ACTIVE_TASK
    : PANEL_TAB_OPTIONS.WORKSPACE_SETTINGS;
}

function normalizePromptPath(value) {
  return String(value || "").trim().replace(/\\/g, "/");
}

function createDaemonStatusSnapshot(overrides = {}) {
  return {
    state: DAEMON_CONNECTION_STATES.UNKNOWN,
    checkedAt: 0,
    host: "",
    port: "",
    error: "",
    runtimeAvailable: null,
    runtimeMessage: "",
    lastRuntimeError: "",
    ...overrides,
  };
}

function formatDaemonCheckedAt(value) {
  const timestamp = Number(value) || 0;
  if (!timestamp) {
    return "";
  }

  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function getDaemonEndpointLabel(status) {
  const host = String(status?.host || "").trim();
  const port = String(status?.port || "").trim();
  return host && port ? `${host}:${port}` : "";
}

function getDaemonStatusTagClassName(state) {
  switch (state) {
    case DAEMON_CONNECTION_STATES.ONLINE:
      return "is-online";
    case DAEMON_CONNECTION_STATES.OFFLINE:
      return "is-offline";
    case DAEMON_CONNECTION_STATES.CHECKING:
      return "is-checking";
    default:
      return "";
  }
}

function isPathInsideDirectory(candidatePath, directoryPath) {
  const normalizedCandidatePath = String(candidatePath || "").trim();
  const normalizedDirectoryPath = String(directoryPath || "").trim();
  if (!normalizedCandidatePath || !normalizedDirectoryPath) {
    return false;
  }

  const relativePath = path.relative(normalizedDirectoryPath, normalizedCandidatePath);
  return relativePath === ""
    || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveMarkdownFilePromptPath(file, cwd = "") {
  const absolutePath = String(file?.absolutePath || "").trim();
  const normalizedCwd = String(cwd || "").trim();
  const relativeFilePath = normalizePromptPath(file?.path || "");
  if (absolutePath) {
    return {
      promptPath: normalizePromptPath(absolutePath),
      isDirectPath: true,
    };
  }

  if (normalizedCwd && relativeFilePath) {
    const candidateAbsolutePath = path.resolve(normalizedCwd, relativeFilePath);
    if (fs.existsSync(candidateAbsolutePath)) {
      return {
        promptPath: normalizePromptPath(candidateAbsolutePath),
        isDirectPath: true,
      };
    }
  }

  return {
    promptPath: relativeFilePath,
    isDirectPath: false,
  };
}

function buildMarkdownFilePromptBlock(file, index, options = {}) {
  const { promptPath, isDirectPath } = resolveMarkdownFilePromptPath(file, options.cwd);
  if (promptPath && isDirectPath) {
    return `Markdown file ${index + 1}: ${promptPath}`;
  }

  const filePath = promptPath || String(file?.path || file?.absolutePath || "").trim();
  const fileContent = String(file?.content || "");
  if (filePath && fileContent) {
    return `Markdown file ${index + 1}: ${filePath}\n\n\`\`\`md\n${fileContent}\n\`\`\``;
  }

  return filePath
    ? `Markdown file ${index + 1}: ${filePath}`
    : `Markdown file ${index + 1}`;
}

function shouldAppendUserRequest(textBlocks, markdownFiles, trimmedMessage, includeContext = true) {
  if (!trimmedMessage) {
    return false;
  }

  if (!includeContext) {
    return true;
  }

  if (textBlocks.length !== 1) {
    return true;
  }

  if (Array.isArray(markdownFiles) && markdownFiles.length > 0) {
    return true;
  }

  return String(textBlocks[0]?.text || "").trim() !== trimmedMessage;
}

function buildCanvasSelectionPrompt(selection, userMessage, options = {}) {
  const textBlocks = Array.isArray(selection?.textBlocks)
    ? selection.textBlocks.filter((block) => String(block?.text || "").trim())
    : [];
  const markdownFiles = Array.isArray(selection?.markdownFiles)
    ? selection.markdownFiles.filter((file) => String(file?.path || "").trim())
    : [];
  const warnings = Array.isArray(selection?.warnings)
    ? selection.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
    : [];
  const trimmedMessage = String(userMessage || "").trim();
  const parts = [
    "You are working from an Obsidian Canvas selection. Treat the following nodes as the task context.",
  ];

  if (textBlocks.length > 0) {
    parts.push(
      textBlocks
        .map((block, index) => `Text node ${index + 1}:\n${String(block.text || "")}`)
        .join("\n\n")
    );
  }

  if (markdownFiles.length > 0) {
    parts.push("Before answering, open and read each linked markdown file from disk. Use the file contents as required context, not just the link text.");
    parts.push(
      markdownFiles
        .map((file, index) => buildMarkdownFilePromptBlock(file, index, options))
        .join("\n\n")
    );
  }

  if (warnings.length > 0) {
    parts.push(`Resolver warnings:\n- ${warnings.join("\n- ")}`);
  }

  if (shouldAppendUserRequest(textBlocks, markdownFiles, trimmedMessage, true)) {
    parts.push(`User request:\n${trimmedMessage}`);
  }

  return parts.join("\n\n").trim();
}

function basenameVaultPath(value) {
  const normalized = String(value || "").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return "";
  }
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function normalizeDaemonSandboxMode(value) {
  return value === DAEMON_SANDBOX_MODE_OPTIONS.DANGER_FULL_ACCESS
    ? DAEMON_SANDBOX_MODE_OPTIONS.DANGER_FULL_ACCESS
    : DAEMON_SANDBOX_MODE_OPTIONS.WORKSPACE_WRITE;
}

function getDaemonSandboxModeLabel(value) {
  return normalizeDaemonSandboxMode(value) === DAEMON_SANDBOX_MODE_OPTIONS.DANGER_FULL_ACCESS
    ? "Full access"
    : "Workspace only";
}

function getDaemonSandboxModeHelpText(value) {
  return normalizeDaemonSandboxMode(value) === DAEMON_SANDBOX_MODE_OPTIONS.DANGER_FULL_ACCESS
    ? "Full access removes the filesystem sandbox and can reach files outside the selected project folder. Use it only for repos and prompts you trust."
    : "Workspace-only keeps Codex limited to the selected project folder and is the safer default for normal work.";
}

function normalizeRepoPath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    return "";
  }

  return path.normalize(trimmed);
}

function compactPathLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return path.basename(normalized) || normalized;
}

function inferWorkspaceNameFromRepoPath(repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  return normalized ? path.basename(normalized) : "";
}

function stableShortHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex").slice(0, 16);
}

function createCanvasObjectId(prefix = "oa-canvas") {
  const normalizedPrefix = String(prefix || "oa-canvas").trim() || "oa-canvas";
  if (typeof crypto.randomUUID === "function") {
    return `${normalizedPrefix}-${crypto.randomUUID()}`;
  }

  return `${normalizedPrefix}-${stableShortHash(`${Date.now()}\0${Math.random().toString(16)}`)}`;
}

function buildTaskResultNodeId(taskId, sourceNodeId) {
  return `oa-result-${stableShortHash(`${String(taskId || "").trim()}\0${String(sourceNodeId || "").trim()}`)}`;
}

function getOpenAgentCanvasMetadata(value) {
  const metadata = value?.openagent;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null;
}

function isOpenAgentAssistantResultNode(node) {
  const metadata = getOpenAgentCanvasMetadata(node);
  return metadata?.kind === "assistant-result" || String(node?.id || "").startsWith("oa-result-");
}

function getOpenAgentResultSourceNodeId(node) {
  const metadata = getOpenAgentCanvasMetadata(node);
  return metadata?.kind === "assistant-result" ? String(metadata.sourceNodeId || "").trim() : "";
}

function getOpenAgentResultTaskId(node) {
  const metadata = getOpenAgentCanvasMetadata(node);
  return metadata?.kind === "assistant-result" ? String(metadata.taskId || "").trim() : "";
}

function normalizeResultNodeSyncState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([taskId, signature]) => [String(taskId || "").trim(), String(signature || "").trim()])
      .filter(([taskId, signature]) => taskId && signature)
  );
}

function normalizeCanvasRunSourceRefState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([taskId, ref]) => {
        const normalizedTaskId = String(taskId || "").trim();
        const canvasPath = String(ref?.canvasPath || "").trim();
        const nodeId = String(ref?.nodeId || "").trim();
        return [normalizedTaskId, { canvasPath, nodeId }];
      })
      .filter(([taskId, ref]) => taskId && ref.canvasPath && ref.nodeId)
  );
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function estimateCanvasTextNodeHeight(text, width = RESULT_NODE_DEFAULT_WIDTH) {
  const normalizedText = String(text || "").replace(/\r\n/g, "\n");
  if (!normalizedText.trim()) {
    return RESULT_NODE_MIN_HEIGHT;
  }

  const charsPerLine = clampNumber(
    Math.round(toFiniteNumber(width, RESULT_NODE_DEFAULT_WIDTH) / 8),
    24,
    RESULT_NODE_CHARS_PER_LINE
  );
  const visualLines = normalizedText
    .split("\n")
    .reduce((count, line) => count + Math.max(1, Math.ceil(Math.max(1, line.length) / charsPerLine)), 0);

  return clampNumber(88 + (visualLines * 22), RESULT_NODE_MIN_HEIGHT, RESULT_NODE_MAX_HEIGHT);
}

function compareCanvasNodeOrder(a, b) {
  const yDifference = toFiniteNumber(a?.y, 0) - toFiniteNumber(b?.y, 0);
  if (yDifference !== 0) {
    return yDifference;
  }

  const xDifference = toFiniteNumber(a?.x, 0) - toFiniteNumber(b?.x, 0);
  if (xDifference !== 0) {
    return xDifference;
  }

  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function averageNumbers(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function getCanvasLayoutNodeWidth(node) {
  const fallbackWidth = String(node?.type || "").trim() === "text" ? RESULT_NODE_DEFAULT_WIDTH : 360;
  return Math.max(CANVAS_LAYOUT_MIN_WIDTH, toFiniteNumber(node?.width, fallbackWidth));
}

function getCanvasLayoutNodeHeight(node, width) {
  const existingHeight = toFiniteNumber(node?.height, 0);
  if (existingHeight > 0) {
    return Math.max(CANVAS_LAYOUT_MIN_HEIGHT, existingHeight);
  }

  if (String(node?.type || "").trim() === "text") {
    return Math.max(CANVAS_LAYOUT_MIN_HEIGHT, estimateCanvasTextNodeHeight(node?.text, width));
  }

  return 220;
}

function getCanvasNodeCenter(node) {
  if (!node || typeof node !== "object") {
    return null;
  }

  const width = Math.max(0, toFiniteNumber(node.width, 0));
  const height = Math.max(0, toFiniteNumber(node.height, 0));
  return {
    x: toFiniteNumber(node.x, 0) + (width / 2),
    y: toFiniteNumber(node.y, 0) + (height / 2),
  };
}

function doesCanvasGroupContainNode(groupNode, candidateNode) {
  if (String(groupNode?.type || "").trim() !== "group") {
    return false;
  }

  const center = getCanvasNodeCenter(candidateNode);
  if (!center) {
    return false;
  }

  const groupX = toFiniteNumber(groupNode.x, 0);
  const groupY = toFiniteNumber(groupNode.y, 0);
  const groupWidth = Math.max(0, toFiniteNumber(groupNode.width, 0));
  const groupHeight = Math.max(0, toFiniteNumber(groupNode.height, 0));
  return (
    center.x >= groupX
    && center.x <= groupX + groupWidth
    && center.y >= groupY
    && center.y <= groupY + groupHeight
  );
}

function escapeAttributeSelectorValue(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function parseIsoTimestamp(value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return null;
  }

  const timestamp = Date.parse(normalizedValue);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getStartOfLocalDayTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatTaskListDayLabel(dayTimestamp) {
  const normalizedDayTimestamp = Number(dayTimestamp);
  if (!Number.isFinite(normalizedDayTimestamp)) {
    return "Unknown";
  }

  const dayDate = new Date(normalizedDayTimestamp);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayDifference = Math.round((today.getTime() - normalizedDayTimestamp) / 86_400_000);
  if (dayDifference === 0) {
    return "Today";
  }
  if (dayDifference === 1) {
    return "Yesterday";
  }

  return dayDate.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: dayDate.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function autoArrangeCanvasNodes(nodes, edges) {
  const originalNodes = Array.isArray(nodes)
    ? nodes
    : [];
  const normalizedNodes = originalNodes.filter((node) => String(node?.id || "").trim());
  const groupNodes = normalizedNodes.filter((node) => String(node?.type || "").trim() === "group");
  const layoutNodes = normalizedNodes.filter((node) => {
    if (String(node?.type || "").trim() === "group") {
      return false;
    }

    // Leave group contents untouched so auto-arrange only reflows top-level nodes.
    return !groupNodes.some((groupNode) => doesCanvasGroupContainNode(groupNode, node));
  });
  if (layoutNodes.length <= 1) {
    return originalNodes;
  }

  const normalizedEdges = Array.isArray(edges) ? edges : [];
  const nodeById = new Map(
    layoutNodes.map((node) => [String(node.id || "").trim(), node])
  );
  const outgoingNodeIdsByNodeId = new Map();
  const incomingNodeIdsByNodeId = new Map();
  const neighborNodeIdsByNodeId = new Map();

  nodeById.forEach((_node, nodeId) => {
    outgoingNodeIdsByNodeId.set(nodeId, []);
    incomingNodeIdsByNodeId.set(nodeId, []);
    neighborNodeIdsByNodeId.set(nodeId, []);
  });

  normalizedEdges.forEach((edge) => {
    const fromNodeId = String(edge?.fromNode || "").trim();
    const toNodeId = String(edge?.toNode || "").trim();
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
      return;
    }
    if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) {
      return;
    }

    outgoingNodeIdsByNodeId.get(fromNodeId).push(toNodeId);
    incomingNodeIdsByNodeId.get(toNodeId).push(fromNodeId);
    neighborNodeIdsByNodeId.get(fromNodeId).push(toNodeId);
    neighborNodeIdsByNodeId.get(toNodeId).push(fromNodeId);
  });

  const sortNodeIds = (nodeIds) => {
    return [...new Set(nodeIds)].sort((leftNodeId, rightNodeId) => {
      return compareCanvasNodeOrder(nodeById.get(leftNodeId), nodeById.get(rightNodeId));
    });
  };

  const orderedNodeIds = sortNodeIds([...nodeById.keys()]);
  const unvisitedNodeIds = new Set(orderedNodeIds);
  const connectedComponents = [];

  while (unvisitedNodeIds.size > 0) {
    const startNodeId = orderedNodeIds.find((nodeId) => unvisitedNodeIds.has(nodeId));
    if (!startNodeId) {
      break;
    }

    const componentNodeIds = [];
    const queue = [startNodeId];
    unvisitedNodeIds.delete(startNodeId);

    while (queue.length > 0) {
      const currentNodeId = queue.shift();
      componentNodeIds.push(currentNodeId);

      sortNodeIds(neighborNodeIdsByNodeId.get(currentNodeId) || []).forEach((neighborNodeId) => {
        if (!unvisitedNodeIds.has(neighborNodeId)) {
          return;
        }

        unvisitedNodeIds.delete(neighborNodeId);
        queue.push(neighborNodeId);
      });
    }

    connectedComponents.push(sortNodeIds(componentNodeIds));
  }

  const isolatedNodeIds = [];
  const layoutComponents = connectedComponents.filter((componentNodeIds) => {
    if (componentNodeIds.length !== 1) {
      return true;
    }

    const nodeId = componentNodeIds[0];
    if ((neighborNodeIdsByNodeId.get(nodeId) || []).length > 0) {
      return true;
    }

    isolatedNodeIds.push(nodeId);
    return false;
  });
  if (isolatedNodeIds.length > 0) {
    layoutComponents.push(sortNodeIds(isolatedNodeIds));
  }

  const nextPositionByNodeId = new Map();
  let componentOffsetX = CANVAS_LAYOUT_BASE_X;

  [...layoutComponents].reverse().forEach((componentNodeIds) => {
    const componentNodeIdSet = new Set(componentNodeIds);
    const localIncomingCountByNodeId = new Map();
    const depthByNodeId = new Map();
    const pendingNodeIds = [];
    const consumedNodeIds = new Set();

    componentNodeIds.forEach((nodeId) => {
      const incomingNodeIds = (incomingNodeIdsByNodeId.get(nodeId) || []).filter((incomingNodeId) => {
        return componentNodeIdSet.has(incomingNodeId);
      });
      localIncomingCountByNodeId.set(nodeId, incomingNodeIds.length);
      if (incomingNodeIds.length === 0) {
        depthByNodeId.set(nodeId, 0);
        pendingNodeIds.push(nodeId);
      }
    });

    while (pendingNodeIds.length > 0) {
      pendingNodeIds.sort((leftNodeId, rightNodeId) => {
        return compareCanvasNodeOrder(nodeById.get(leftNodeId), nodeById.get(rightNodeId));
      });
      const currentNodeId = pendingNodeIds.shift();
      if (consumedNodeIds.has(currentNodeId)) {
        continue;
      }

      consumedNodeIds.add(currentNodeId);
      const nextDepth = (depthByNodeId.get(currentNodeId) || 0) + 1;

      sortNodeIds((outgoingNodeIdsByNodeId.get(currentNodeId) || []).filter((nextNodeId) => {
        return componentNodeIdSet.has(nextNodeId);
      })).forEach((nextNodeId) => {
        depthByNodeId.set(nextNodeId, Math.max(depthByNodeId.get(nextNodeId) || 0, nextDepth));
        localIncomingCountByNodeId.set(nextNodeId, Math.max(0, (localIncomingCountByNodeId.get(nextNodeId) || 0) - 1));
        if ((localIncomingCountByNodeId.get(nextNodeId) || 0) === 0) {
          pendingNodeIds.push(nextNodeId);
        }
      });
    }

    let maxDepth = depthByNodeId.size > 0
      ? Math.max(...depthByNodeId.values())
      : 0;

    sortNodeIds(componentNodeIds.filter((nodeId) => !depthByNodeId.has(nodeId))).forEach((nodeId) => {
      const incomingDepths = (incomingNodeIdsByNodeId.get(nodeId) || [])
        .filter((incomingNodeId) => componentNodeIdSet.has(incomingNodeId) && depthByNodeId.has(incomingNodeId))
        .map((incomingNodeId) => depthByNodeId.get(incomingNodeId));
      const suggestedDepth = incomingDepths.length > 0 ? Math.max(...incomingDepths) + 1 : maxDepth + 1;
      depthByNodeId.set(nodeId, suggestedDepth);
      maxDepth = Math.max(maxDepth, suggestedDepth);
    });

    const rowDepths = [...new Set(componentNodeIds.map((nodeId) => depthByNodeId.get(nodeId) || 0))].sort((leftDepth, rightDepth) => {
      return leftDepth - rightDepth;
    });
    const rowHeightByDepth = new Map();
    rowDepths.forEach((depth) => {
      const rowHeight = componentNodeIds
        .filter((nodeId) => (depthByNodeId.get(nodeId) || 0) === depth)
        .reduce((maxHeight, nodeId) => {
          const width = getCanvasLayoutNodeWidth(nodeById.get(nodeId));
          return Math.max(maxHeight, getCanvasLayoutNodeHeight(nodeById.get(nodeId), width));
        }, CANVAS_LAYOUT_MIN_HEIGHT);
      rowHeightByDepth.set(depth, rowHeight);
    });

    const placedCenterXByNodeId = new Map();
    let componentWidth = 0;
    let rowOffsetY = CANVAS_LAYOUT_BASE_Y;

    rowDepths.forEach((depth, rowIndex) => {
      if (rowIndex > 0) {
        const previousDepth = rowDepths[rowIndex - 1];
        rowOffsetY += (rowHeightByDepth.get(previousDepth) || CANVAS_LAYOUT_MIN_HEIGHT) + CANVAS_LAYOUT_Y_GAP;
      }

      const rowNodeIds = componentNodeIds
        .filter((nodeId) => (depthByNodeId.get(nodeId) || 0) === depth)
        .sort((leftNodeId, rightNodeId) => {
          const leftAverageIncomingCenter = averageNumbers(
            (incomingNodeIdsByNodeId.get(leftNodeId) || [])
              .map((incomingNodeId) => placedCenterXByNodeId.get(incomingNodeId))
              .filter((value) => Number.isFinite(value))
          );
          const rightAverageIncomingCenter = averageNumbers(
            (incomingNodeIdsByNodeId.get(rightNodeId) || [])
              .map((incomingNodeId) => placedCenterXByNodeId.get(incomingNodeId))
              .filter((value) => Number.isFinite(value))
          );
          if (leftAverageIncomingCenter !== null && rightAverageIncomingCenter !== null && leftAverageIncomingCenter !== rightAverageIncomingCenter) {
            return leftAverageIncomingCenter - rightAverageIncomingCenter;
          }
          if (leftAverageIncomingCenter !== null || rightAverageIncomingCenter !== null) {
            return leftAverageIncomingCenter === null ? 1 : -1;
          }

          return compareCanvasNodeOrder(nodeById.get(leftNodeId), nodeById.get(rightNodeId));
        });

      let rowOffsetX = 0;
      rowNodeIds.forEach((nodeId) => {
        const node = nodeById.get(nodeId);
        const width = getCanvasLayoutNodeWidth(node);
        const height = getCanvasLayoutNodeHeight(node, width);
        nextPositionByNodeId.set(nodeId, {
          x: componentOffsetX + rowOffsetX,
          y: rowOffsetY,
        });
        placedCenterXByNodeId.set(nodeId, rowOffsetX + (width / 2));
        rowOffsetX += width + CANVAS_LAYOUT_X_GAP;
      });

      componentWidth = Math.max(componentWidth, Math.max(0, rowOffsetX - CANVAS_LAYOUT_X_GAP));
    });

    componentOffsetX += componentWidth + CANVAS_LAYOUT_COMPONENT_GAP;
  });

  return originalNodes.map((node) => {
    const nodeId = String(node?.id || "").trim();
    const nextPosition = nextPositionByNodeId.get(nodeId);
    if (!nextPosition) {
      return node;
    }

    return {
      ...node,
      x: nextPosition.x,
      y: nextPosition.y,
    };
  });
}

class WorkspacePickerModal extends Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.options = options;
    this.repoPathInput = null;
    this.workspaceNameInput = null;
  }

  onOpen() {
    const loadPromise = this.plugin.ensureWorkspaceSummariesLoaded();
    this.render();
    void loadPromise.finally(() => {
      if (this.contentEl?.isConnected) {
        this.render();
      }
    });
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oa-workspace-modal");
    contentEl.createEl("h2", { text: "Choose workspace" });
    contentEl.createDiv({
      cls: "oa-workspace-modal-subtitle",
      text: "Open an existing repo workspace or create a new Canvas home for a project.",
    });

    const existing = this.plugin.listWorkspaceSummaries();
    const isLoadingWorkspaces = this.plugin.isWorkspaceSummariesLoading();
    const existingSection = contentEl.createDiv({ cls: "oa-workspace-section" });
    existingSection.createEl("h3", { text: "Existing workspaces" });

    if (existing.length === 0 && isLoadingWorkspaces) {
      existingSection.createDiv({
        cls: "oa-muted",
        text: "Loading workspaces...",
      });
    } else if (existing.length === 0) {
      existingSection.createDiv({
        cls: "oa-muted",
        text: "No workspace yet. Create one from a repo path below.",
      });
    } else {
      const list = existingSection.createDiv({ cls: "oa-workspace-list" });
      existing.forEach((workspace) => {
        const item = list.createDiv({ cls: "oa-workspace-item" });
        const itemMain = item.createDiv({ cls: "oa-workspace-item-main" });
        itemMain.createDiv({ cls: "oa-task-title", text: workspace.name });
        itemMain.createDiv({ cls: "oa-task-meta", text: workspace.repoPath });
        const buttonRow = item.createDiv({ cls: "oa-action-row" });
        const openButton = new ButtonComponent(buttonRow);
        openButton.setButtonText("Open");
        openButton.buttonEl?.addClass("oa-workspace-open-button");
        openButton.onClick(async () => {
          await this.plugin.openWorkspace(workspace);
          this.close();
        });
      });
    }

    const createSection = contentEl.createDiv({ cls: "oa-workspace-section oa-workspace-create-panel" });
    createSection.createEl("h3", { text: "Create workspace" });

    new Setting(createSection)
      .setName("Repo path")
      .setDesc("Absolute filesystem path to the repo folder that Codex should use for this workspace.")
      .addText((text) => {
        this.repoPathInput = text;
        text
          .setPlaceholder("/absolute/path/to/repo")
          .setValue("");
      })
      .addButton((button) => {
        button.setButtonText("Browse...");
        button.onClick(async () => {
          try {
            const defaultPath = this.repoPathInput?.getValue?.() || "";
            const selectedPath = await this.plugin.pickDirectoryPath({
              defaultPath,
              title: "Choose repo folder",
            });
            if (!selectedPath) {
              return;
            }

            this.repoPathInput?.setValue(selectedPath);
            if (this.workspaceNameInput && !String(this.workspaceNameInput.getValue?.() || "").trim()) {
              this.workspaceNameInput.setValue(inferWorkspaceNameFromRepoPath(selectedPath));
            }
          } catch (error) {
            new Notice(String(error?.message || error));
          }
        });
      });

    new Setting(createSection)
      .setName("Workspace name")
      .setDesc("Optional. Leave blank to use the repo folder name.")
      .addText((text) => {
        this.workspaceNameInput = text;
        text
          .setPlaceholder("openagent")
          .setValue("");
      });

    const actions = createSection.createDiv({ cls: "oa-action-row" });
    const createButton = new ButtonComponent(actions);
    createButton.setButtonText("Create");
    createButton.setCta();
    createButton.onClick(async () => {
      try {
        const repoPath = this.repoPathInput?.getValue?.() || "";
        const workspaceName = this.workspaceNameInput?.getValue?.() || "";
        await this.plugin.createWorkspaceFromRepoPath(repoPath, workspaceName);
        this.close();
      } catch (error) {
        new Notice(String(error?.message || error));
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class OpenAgentDaemonLauncher {
  constructor(plugin) {
    this.plugin = plugin;
    this.startPromise = null;
  }

  async ensureStarted() {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startInternal() {
    const launchSpec = this.resolveLaunchSpec();
    if (!launchSpec?.command) {
      throw new Error(
        "OpenAgent daemon is not running, and auto-launch could not find this repo. Set a daemon launch command in OpenAgent settings."
      );
    }

    fs.mkdirSync(path.dirname(DAEMON_LOG_PATH), { recursive: true });

    const shellCommand = `${launchSpec.command} >> ${shellEscape(DAEMON_LOG_PATH)} 2>&1`;
    const child = spawn("/bin/zsh", ["-lc", shellCommand], {
      cwd: launchSpec.cwd || os.homedir(),
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    await this.waitForReady();
  }

  resolveLaunchSpec() {
    const configuredCommand = String(this.plugin.settings?.daemonLaunchCommand || "").trim();
    const configuredCwd = this.normalizeDirectory(this.plugin.settings?.daemonLaunchCwd);
    if (configuredCommand) {
      return {
        cwd: configuredCwd || os.homedir(),
        command: configuredCommand,
      };
    }

    const repoRoot = this.findRepoRoot();
    if (!repoRoot) {
      return null;
    }

    return {
      cwd: repoRoot,
      command: `cd ${shellEscape(repoRoot)} && exec pnpm dev:daemon`,
    };
  }

  findRepoRoot() {
    const candidates = [
      this.findRepoNearPlugin(),
      path.join(os.homedir(), "Documents", "GitHub", "openagent"),
      path.join(os.homedir(), "GitHub", "openagent"),
      path.join(os.homedir(), "Documents", "openagent"),
      path.join(os.homedir(), "openagent"),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const daemonPath = path.join(candidate, "apps", "openagent-daemon", "src", "server.js");
      const packagePath = path.join(candidate, "package.json");
      if (fs.existsSync(daemonPath) && fs.existsSync(packagePath)) {
        return candidate;
      }
    }

    return "";
  }

  findRepoNearPlugin() {
    let currentPath = __dirname;
    while (currentPath) {
      const daemonPath = path.join(currentPath, "apps", "openagent-daemon", "src", "server.js");
      if (fs.existsSync(daemonPath)) {
        return currentPath;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        return "";
      }
      currentPath = parentPath;
    }

    return "";
  }

  normalizeDirectory(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed || !path.isAbsolute(trimmed)) {
      return "";
    }

    const normalized = path.normalize(trimmed);
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
      return "";
    }

    return normalized;
  }

  async waitForReady() {
    let lastError = null;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(attempt === 0 ? 250 : 500);

      try {
        await this.plugin.api.requestOnce("GET", "/health");
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("OpenAgent daemon did not become ready.");
  }
}

class OpenAgentApiClient {
  constructor(options = {}) {
    this.config = null;
    this.daemonLauncher = options.daemonLauncher || null;
  }

  loadConfig() {
    if (this.config) {
      return this.config;
    }

    if (!fs.existsSync(DAEMON_CONFIG_PATH)) {
      throw new Error("OpenAgent daemon config was not found. Start the daemon first.");
    }

    const parsed = JSON.parse(fs.readFileSync(DAEMON_CONFIG_PATH, "utf8"));
    if (!parsed?.host || !parsed?.port || !parsed?.token) {
      throw new Error("OpenAgent daemon config is invalid.");
    }

    this.config = parsed;
    return this.config;
  }

  async request(method, route, body = null) {
    try {
      return await this.requestOnce(method, route, body);
    } catch (error) {
      if (!this.shouldTryAutoLaunch(error)) {
        throw error;
      }

      if (!this.daemonLauncher) {
        throw error;
      }

      this.config = null;
      await this.daemonLauncher.ensureStarted();
      this.config = null;
      return this.requestOnce(method, route, body);
    }
  }

  async requestOnce(method, route, body = null) {
    const config = this.loadConfig();

    return new Promise((resolve, reject) => {
      const payload = body == null ? null : JSON.stringify(body);
      const request = http.request({
        host: config.host,
        port: config.port,
        path: route,
        method,
        headers: {
          "content-type": "application/json",
          "x-openagent-token": config.token,
          ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
        },
      }, (response) => {
        let buffer = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          buffer += chunk;
        });
        response.on("end", () => {
          let parsed = {};
          try {
            parsed = buffer.trim() ? JSON.parse(buffer) : {};
          } catch (error) {
            reject(new Error(`Unable to parse daemon response: ${error.message}`));
            return;
          }

          if (response.statusCode >= 400) {
            reject(new Error(parsed?.error?.message || `Daemon request failed (${response.statusCode}).`));
            return;
          }

          resolve(parsed);
        });
      });

      request.on("error", (error) => {
        reject(new Error(`Unable to reach the OpenAgent daemon: ${error.message}`));
      });

      if (payload) {
        request.write(payload);
      }

      request.end();
    });
  }

  shouldTryAutoLaunch(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return (
      message.includes("daemon config was not found")
      || message.includes("unable to reach the openagent daemon")
      || message.includes("econnrefused")
      || message.includes("connect enoent")
    );
  }

  getHealth() {
    return this.request("GET", "/health");
  }

  getHealthOnce(options = {}) {
    if (options.reloadConfig === true) {
      this.config = null;
    }
    return this.requestOnce("GET", "/health");
  }

  getTasks() {
    return this.request("GET", "/tasks");
  }

  getTask(taskId) {
    return this.request("GET", `/tasks/${encodeURIComponent(taskId)}`);
  }

  createTaskFromCanvasSelection(selection) {
    return this.request("POST", "/tasks/from-canvas-selection", selection);
  }

  runTask(taskId, body = {}) {
    return this.request("POST", `/tasks/${encodeURIComponent(taskId)}/run`, body);
  }

  sendMessage(taskId, text, runtimeConfig = null) {
    return this.request("POST", `/tasks/${encodeURIComponent(taskId)}/messages`, {
      text,
      ...(runtimeConfig ? { runtimeConfig } : {}),
    });
  }

  updateTaskCanvasBinding(taskId, body = {}) {
    return this.request("PATCH", `/tasks/${encodeURIComponent(taskId)}/canvas-binding`, body);
  }

  interruptTask(taskId) {
    return this.request("POST", `/tasks/${encodeURIComponent(taskId)}/interrupt`, {});
  }

  openTaskStream(taskId, onEvent) {
    const config = this.loadConfig();
    const request = http.request({
      host: config.host,
      port: config.port,
      path: `/tasks/${encodeURIComponent(taskId)}/stream`,
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "x-openagent-token": config.token,
      },
    });

    let buffer = "";
    request.on("response", (response) => {
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        buffer += chunk;

        while (buffer.includes("\n\n")) {
          const boundary = buffer.indexOf("\n\n");
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          const lines = block.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              event = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              data += line.slice(5).trim();
            }
          }

          if (!data) {
            continue;
          }

          try {
            onEvent(event, JSON.parse(data));
          } catch {
            // Ignore malformed stream frames.
          }
        }
      });
    });

    request.on("error", () => {});
    request.end();

    return () => request.destroy();
  }
}

class CanvasSelectionResolver {
  constructor(app) {
    this.app = app;
  }

  async resolveActiveSelection() {
    const view = this.getActiveCanvasView();
    if (!view) {
      throw new Error("Open a Canvas view first.");
    }

    const file = view.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "canvas") {
      throw new Error("The active view is not backed by a .canvas file.");
    }

    const selectedNodeIds = this.extractSelectedNodeIds(view);
    if (selectedNodeIds.length === 0) {
      throw new Error("Select one or more Canvas nodes first.");
    }

    const liveNodeDataById = this.extractLiveSelectedNodeDataById(view, selectedNodeIds);
    await this.flushPendingCanvasEdits(view);

    return this.resolveCanvasSelection(file, selectedNodeIds, { view, liveNodeDataById });
  }

  getActiveCanvasView() {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view?.getViewType?.() === "canvas") {
      return activeLeaf.view;
    }

    const canvasLeaves = this.app.workspace.getLeavesOfType("canvas");
    return canvasLeaves[0]?.view || null;
  }

  isEditableCanvasElement(element) {
    if (!element || typeof element !== "object") {
      return false;
    }

    if (typeof element.matches === "function" && element.matches("textarea, input, [contenteditable='true'], .cm-content")) {
      return true;
    }

    return Boolean(element.closest?.("[contenteditable='true'], .cm-content"));
  }

  async requestCanvasSave(view) {
    const calls = [
      [view, "requestSave"],
      [view, "save"],
      [view?.canvas, "requestSave"],
      [view?.canvas, "save"],
    ];

    for (const [owner, method] of calls) {
      if (typeof owner?.[method] !== "function") {
        continue;
      }

      try {
        const result = owner[method]();
        if (result && typeof result.then === "function") {
          await result;
        }
      } catch {
        // Canvas internals differ between Obsidian versions; best effort is enough here.
      }
    }
  }

  async flushPendingCanvasEdits(view) {
    const containerEl = view?.containerEl;
    const activeElement = containerEl?.ownerDocument?.activeElement;
    const isEditingCanvas = Boolean(
      activeElement
      && typeof containerEl?.contains === "function"
      && containerEl.contains(activeElement)
      && this.isEditableCanvasElement(activeElement)
    );

    if (isEditingCanvas && typeof activeElement.blur === "function") {
      activeElement.blur();
      await sleep(0);
    }

    await this.requestCanvasSave(view);

    if (isEditingCanvas) {
      await sleep(50);
      await this.requestCanvasSave(view);
    }
  }

  async resolveCanvasSelection(file, selectedNodeIds, options = {}) {
    const liveSelectedNodeDataById = options.liveNodeDataById instanceof Map
      ? new Map(options.liveNodeDataById)
      : new Map();
    this.extractLiveSelectedNodeDataById(options.view, selectedNodeIds).forEach((nodeData, nodeId) => {
      const previous = liveSelectedNodeDataById.get(nodeId) || {};
      liveSelectedNodeDataById.set(nodeId, { ...previous, ...nodeData });
    });
    const raw = await this.app.vault.cachedRead(file);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Unable to parse canvas JSON for ${file.path}`);
    }

    const selectedIdSet = new Set(selectedNodeIds.map((nodeId) => String(nodeId)));
    const selectedNodes = Array.isArray(parsed.nodes)
      ? parsed.nodes
        .filter((node) => selectedIdSet.has(String(node.id)))
        .map((node) => {
          const liveNodeData = liveSelectedNodeDataById.get(String(node?.id || ""));
          return liveNodeData ? { ...node, ...liveNodeData } : node;
        })
      : [];

    if (selectedNodes.length === 0) {
      throw new Error("The saved Canvas file does not contain the current selection.");
    }

    const textBlocks = [];
    const markdownFiles = [];
    const warnings = [];

    for (const node of selectedNodes) {
      const nodeId = String(node.id || "");
      if (!nodeId) {
        continue;
      }

      if (node.type === "text") {
        const text = typeof node.text === "string" ? node.text.trim() : "";
        if (text) {
          textBlocks.push({ id: nodeId, text });
        } else {
          warnings.push(`Text node ${nodeId} is empty.`);
        }
        continue;
      }

      if (node.type === "file") {
        const markdownFile = await this.buildCanvasMarkdownFileSelectionEntry(node, warnings);
        if (markdownFile) {
          markdownFiles.push(markdownFile);
        }
        continue;
      }

      warnings.push(`Unsupported canvas node type skipped: ${node.type || "unknown"}`);
    }

    const normalizedNodeIds = selectedNodes
      .map((node) => String(node.id))
      .filter(Boolean)
      .sort();

    return {
      canvasPath: file.path,
      canvasName: file.basename,
      nodeIds: normalizedNodeIds,
      textBlocks,
      markdownFiles,
      warnings,
      title: this.deriveTitle(file.basename, textBlocks, markdownFiles),
    };
  }

  getCanvasNodeCenter(node) {
    return getCanvasNodeCenter(node);
  }

  doesCanvasGroupContainNode(groupNode, candidateNode) {
    return doesCanvasGroupContainNode(groupNode, candidateNode);
  }

  findSmallestCanvasGroupForNode(nodes, candidateNode) {
    if (!Array.isArray(nodes) || !candidateNode) {
      return null;
    }

    const containingGroups = nodes
      .filter((node) => this.doesCanvasGroupContainNode(node, candidateNode))
      .sort((a, b) => (
        (Math.max(0, toFiniteNumber(a?.width, 0)) * Math.max(0, toFiniteNumber(a?.height, 0)))
        - (Math.max(0, toFiniteNumber(b?.width, 0)) * Math.max(0, toFiniteNumber(b?.height, 0)))
      ));

    return containingGroups[0] || null;
  }

  async buildCanvasMarkdownFileSelectionEntry(node, warnings) {
    const filePath = typeof node?.file === "string" ? node.file.trim() : "";
    const abstractFile = await this.waitForMarkdownCanvasFile(filePath);
    if (!(abstractFile instanceof TFile)) {
      warnings.push(`Missing file node target: ${filePath}`);
      return null;
    }

    if (abstractFile.extension !== "md") {
      warnings.push(`Unsupported file node type skipped: ${filePath}`);
      return null;
    }

    const vaultBasePath = this.getVaultBasePath();
    return {
      id: String(node?.id || ""),
      path: abstractFile.path,
      absolutePath: vaultBasePath
        ? this.resolveVaultPath(vaultBasePath, abstractFile.path)
        : "",
      name: abstractFile.basename,
      content: await this.app.vault.cachedRead(abstractFile),
    };
  }

  async waitForMarkdownCanvasFile(filePath, options = {}) {
    const normalizedPath = String(filePath || "").trim();
    const timeoutMs = Math.max(0, toFiniteNumber(options.timeoutMs, 4_000));
    const pollMs = Math.max(25, toFiniteNumber(options.pollMs, 100));
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const abstractFile = this.app.vault.getAbstractFileByPath(normalizedPath);
      if (!normalizedPath || abstractFile instanceof TFile) {
        return abstractFile || null;
      }

      if (Date.now() >= deadline) {
        return abstractFile || null;
      }

      await sleep(pollMs);
    }
  }

  collectConnectedCanvasNodeIds(edges, sourceNodeId) {
    const normalizedSourceNodeId = String(sourceNodeId || "").trim();
    const connectedNodeIds = new Set();
    if (!normalizedSourceNodeId || !Array.isArray(edges)) {
      return connectedNodeIds;
    }

    edges.forEach((edge) => {
      const fromNodeId = String(edge?.fromNode || "").trim();
      const toNodeId = String(edge?.toNode || "").trim();
      if (fromNodeId === normalizedSourceNodeId && toNodeId) {
        connectedNodeIds.add(toNodeId);
      }
      if (toNodeId === normalizedSourceNodeId && fromNodeId) {
        connectedNodeIds.add(fromNodeId);
      }
    });

    return connectedNodeIds;
  }

  async appendImplicitMarkdownFiles(nodes, warnings, collectedFiles, seenNodeIds, predicate) {
    const candidateNodes = (Array.isArray(nodes) ? nodes : [])
      .filter((node) => {
        const nodeId = String(node?.id || "").trim();
        return nodeId
          && !seenNodeIds.has(nodeId)
          && String(node?.type || "").trim() === "file"
          && predicate(node);
      })
      .sort(compareCanvasNodeOrder);

    for (const node of candidateNodes) {
      const markdownFile = await this.buildCanvasMarkdownFileSelectionEntry(node, warnings);
      if (!markdownFile) {
        continue;
      }

      const nodeId = String(markdownFile.id || "").trim();
      if (!nodeId || seenNodeIds.has(nodeId)) {
        continue;
      }

      seenNodeIds.add(nodeId);
      collectedFiles.push(markdownFile);
    }
  }

  async addImplicitCanvasMarkdownContext(selection) {
    const canvasPath = String(selection?.canvasPath || "").trim();
    const nodeIds = Array.isArray(selection?.nodeIds) ? selection.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean) : [];
    const textBlocks = Array.isArray(selection?.textBlocks) ? selection.textBlocks : [];
    const markdownFiles = Array.isArray(selection?.markdownFiles) ? selection.markdownFiles : [];
    if (!canvasPath || nodeIds.length !== 1 || textBlocks.length !== 1 || markdownFiles.length > 0) {
      return selection;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(canvasPath);
    if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
      return selection;
    }

    let parsed;
    try {
      parsed = JSON.parse(await this.app.vault.cachedRead(abstractFile));
    } catch {
      return selection;
    }

    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    const sourceNodeId = nodeIds[0];
    const sourceNode = nodes.find((node) => String(node?.id || "") === sourceNodeId) || null;
    if (!sourceNode || String(sourceNode?.type || "") !== "text") {
      return selection;
    }

    const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
    const implicitMarkdownFiles = [];
    const nextWarnings = Array.isArray(selection?.warnings) ? [...selection.warnings] : [];
    const seenNodeIds = new Set(markdownFiles.map((file) => String(file?.id || "").trim()).filter(Boolean));
    const connectedNodeIds = this.collectConnectedCanvasNodeIds(edges, sourceNodeId);
    await this.appendImplicitMarkdownFiles(
      nodes,
      nextWarnings,
      implicitMarkdownFiles,
      seenNodeIds,
      (node) => connectedNodeIds.has(String(node?.id || "").trim())
    );

    const containingGroup = this.findSmallestCanvasGroupForNode(nodes, sourceNode);
    if (containingGroup) {
      await this.appendImplicitMarkdownFiles(
        nodes,
        nextWarnings,
        implicitMarkdownFiles,
        seenNodeIds,
        (node) => String(node?.id || "").trim() !== sourceNodeId
          && this.doesCanvasGroupContainNode(containingGroup, node)
      );
    }

    if (implicitMarkdownFiles.length === 0) {
      return selection;
    }

    return {
      ...selection,
      markdownFiles: implicitMarkdownFiles,
      warnings: nextWarnings,
    };
  }

  async addImplicitGroupMarkdownContext(selection) {
    return this.addImplicitCanvasMarkdownContext(selection);
  }

  deriveTitle(canvasName, textBlocks, markdownFiles) {
    if (textBlocks.length > 0) {
      const firstLine = textBlocks[0].text.split("\n")[0].trim();
      if (firstLine) {
        return firstLine.slice(0, 80);
      }
    }

    if (markdownFiles.length > 0) {
      return markdownFiles[0].name || markdownFiles[0].path;
    }

    return `${canvasName} selection`;
  }

  normalizeCanvasNodeData(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const nodeId = String(value.id || "").trim();
    if (!nodeId) {
      return null;
    }

    const normalized = { id: nodeId };
    const nodeType = String(value.type || "").trim();
    if (nodeType) {
      normalized.type = nodeType;
    }

    if (typeof value.text === "string") {
      normalized.text = value.text;
    }

    if (typeof value.file === "string") {
      normalized.file = value.file;
    }

    if (typeof value.subpath === "string") {
      normalized.subpath = value.subpath;
    }

    return normalized;
  }

  extractEditableText(element) {
    if (!element) {
      return "";
    }

    if (typeof element.value === "string") {
      return element.value;
    }

    const cmContent = element.matches?.(".cm-content")
      ? element
      : element.querySelector?.(".cm-content");
    if (cmContent) {
      const lines = Array.from(cmContent.querySelectorAll?.(".cm-line") || []);
      if (lines.length > 0) {
        return lines.map((line) => line.textContent || "").join("\n");
      }
      return typeof cmContent.textContent === "string" ? cmContent.textContent : "";
    }

    return typeof element.textContent === "string" ? element.textContent : "";
  }

  rememberDomTextForNodeElement(element, selectedIdSet, textById) {
    const nodeId = String(element?.getAttribute?.("data-node-id") || "").trim();
    if (!nodeId || (selectedIdSet.size > 0 && !selectedIdSet.has(nodeId))) {
      return;
    }

    const editor = element.querySelector?.("textarea, input, [contenteditable='true'], .cm-content");
    if (!editor) {
      return;
    }

    const liveText = this.extractEditableText(editor);
    if (typeof liveText === "string") {
      textById.set(nodeId, liveText);
    }
  }

  extractSelectedDomTextById(view, selectedIdSet) {
    const selectedElements = view?.containerEl?.querySelectorAll?.(
      "[data-node-id].is-selected, .canvas-node.is-selected[data-node-id], .canvas-node[data-node-id][aria-selected='true']"
    );
    const textById = new Map();
    selectedElements?.forEach((element) => this.rememberDomTextForNodeElement(element, selectedIdSet, textById));

    const activeElement = view?.containerEl?.ownerDocument?.activeElement;
    const activeNodeElement = activeElement?.closest?.("[data-node-id]");
    if (activeNodeElement && view?.containerEl?.contains?.(activeNodeElement)) {
      this.rememberDomTextForNodeElement(activeNodeElement, selectedIdSet, textById);
    }

    return textById;
  }

  extractLiveSelectedNodeDataById(view, selectedNodeIds) {
    const selectedIdSet = new Set(
      (Array.isArray(selectedNodeIds) ? selectedNodeIds : [])
        .map((nodeId) => String(nodeId || "").trim())
        .filter(Boolean)
    );
    const collected = new Map();
    const visited = new WeakSet();
    const canvas = view?.canvas;

    const rememberNodeData = (candidate) => {
      const normalized = this.normalizeCanvasNodeData(candidate);
      if (!normalized || !selectedIdSet.has(normalized.id)) {
        return;
      }

      const previous = collected.get(normalized.id) || {};
      collected.set(normalized.id, { ...previous, ...normalized });
    };

    const ingest = (value) => {
      if (!value) {
        return;
      }

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return;
      }

      if (typeof value.getData === "function") {
        try {
          rememberNodeData(value.getData());
        } catch {
          // Ignore runtime node wrappers that throw while being inspected.
        }
      }

      if (Array.isArray(value)) {
        value.forEach(ingest);
        return;
      }

      if (value instanceof Set) {
        value.forEach(ingest);
        return;
      }

      if (value instanceof Map) {
        value.forEach((mapValue) => {
          rememberNodeData(mapValue);
          ingest(mapValue);
        });
        return;
      }

      if (typeof value !== "object") {
        return;
      }

      if (visited.has(value)) {
        return;
      }
      visited.add(value);

      rememberNodeData(value);
      rememberNodeData(value.data);
      rememberNodeData(value.node);
      rememberNodeData(value.node?.data);
      rememberNodeData(value.item);
      rememberNodeData(value.item?.data);

      [
        value.node,
        value.data,
        value.item,
        value.items,
        value.nodes,
        value.values,
        value.selection,
        value.selectedNodes,
      ].forEach(ingest);
    };

    ingest(canvas?.selection);
    ingest(canvas?.selectionManager?.selection);
    ingest(canvas?.selectionManager?.selectedNodes);
    ingest(canvas?.selectedNodes);

    if (collected.size < selectedIdSet.size) {
      ingest(canvas?.nodes);
    }

    const domTextById = this.extractSelectedDomTextById(view, selectedIdSet);
    domTextById.forEach((text, nodeId) => {
      const previous = collected.get(nodeId) || { id: nodeId, type: "text" };
      collected.set(nodeId, {
        ...previous,
        id: nodeId,
        type: previous.type || "text",
        text,
      });
    });

    return collected;
  }

  extractSelectedNodeIds(view) {
    const canvas = view?.canvas;
    const selectedElements = view?.containerEl?.querySelectorAll?.(
      "[data-node-id].is-selected, .canvas-node.is-selected[data-node-id], .canvas-node[data-node-id][aria-selected='true']"
    );
    const domSelectedNodeIds = new Set();
    if (selectedElements) {
      selectedElements.forEach((element) => {
        const nodeId = element.getAttribute("data-node-id");
        if (nodeId) {
          domSelectedNodeIds.add(String(nodeId));
        }
      });
    }

    if (domSelectedNodeIds.size > 0) {
      return Array.from(domSelectedNodeIds);
    }

    const collected = new Set();
    const visited = new WeakSet();
    const addNodeId = (value) => {
      if (typeof value === "string" || typeof value === "number") {
        collected.add(String(value));
      }
    };

    const ingest = (value) => {
      if (!value) {
        return;
      }

      if (typeof value === "string" || typeof value === "number") {
        addNodeId(value);
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(ingest);
        return;
      }

      if (value instanceof Set) {
        value.forEach(ingest);
        return;
      }

      if (value instanceof Map) {
        value.forEach((mapValue, key) => {
          ingest(mapValue);
          addNodeId(key);
        });
        return;
      }

      if (typeof value !== "object") {
        return;
      }

      if (visited.has(value)) {
        return;
      }
      visited.add(value);

      addNodeId(value.id);
      addNodeId(value.node?.id);
      addNodeId(value.data?.id);
      addNodeId(value.item?.id);

      [
        value.node,
        value.data,
        value.item,
        value.items,
        value.nodes,
        value.values,
        value.selection,
        value.selectedNodes,
      ].forEach(ingest);
    };

    ingest(canvas?.selection);
    ingest(canvas?.selectionManager?.selection);
    ingest(canvas?.selectionManager?.selectedNodes);
    ingest(canvas?.selectedNodes);

    return Array.from(collected);
  }

  inferWorkingDirectory(selection) {
    const vaultBasePath = this.getVaultBasePath();
    if (!vaultBasePath) {
      return "";
    }

    const candidatePaths = [
      this.resolveVaultPath(vaultBasePath, selection.canvasPath),
      ...selection.markdownFiles.map((file) => this.resolveVaultPath(vaultBasePath, file.path)),
    ].filter(Boolean);

    for (const candidatePath of candidatePaths) {
      const repoRoot = this.findNearestGitRoot(candidatePath);
      if (repoRoot) {
        return repoRoot;
      }
    }

    for (const candidatePath of candidatePaths) {
      const existingDirectory = this.findNearestExistingDirectory(candidatePath);
      if (existingDirectory) {
        return existingDirectory;
      }
    }

    return "";
  }

  getVaultBasePath() {
    const adapter = this.app.vault?.adapter;
    if (typeof adapter?.getBasePath === "function") {
      return adapter.getBasePath();
    }
    if (typeof adapter?.basePath === "string" && adapter.basePath.trim()) {
      return adapter.basePath.trim();
    }
    if (typeof adapter?.path === "string" && adapter.path.trim()) {
      return adapter.path.trim();
    }
    return "";
  }

  resolveVaultPath(vaultBasePath, relativePath) {
    const trimmedPath = String(relativePath || "").trim();
    if (!trimmedPath) {
      return "";
    }

    return path.resolve(vaultBasePath, trimmedPath);
  }

  findNearestGitRoot(startPath) {
    let currentPath = this.findNearestExistingDirectory(startPath);
    while (currentPath) {
      const gitPath = path.join(currentPath, ".git");
      if (fs.existsSync(gitPath)) {
        return currentPath;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        return "";
      }
      currentPath = parentPath;
    }

    return "";
  }

  findNearestExistingDirectory(startPath) {
    let currentPath = String(startPath || "").trim();
    if (!currentPath) {
      return "";
    }

    if (fs.existsSync(currentPath)) {
      const stats = fs.statSync(currentPath);
      return stats.isDirectory() ? currentPath : path.dirname(currentPath);
    }

    currentPath = path.dirname(currentPath);
    while (currentPath && currentPath !== path.dirname(currentPath)) {
      if (fs.existsSync(currentPath) && fs.statSync(currentPath).isDirectory()) {
        return currentPath;
      }
      currentPath = path.dirname(currentPath);
    }

    if (currentPath && fs.existsSync(currentPath) && fs.statSync(currentPath).isDirectory()) {
      return currentPath;
    }

    return "";
  }
}

class OpenAgentView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.cwdInput = null;
    this.composerInput = null;
    this.panelScrollEl = null;
    this.panelScrollKey = "";
    this.expandedToolMessages = new Set();
    this.visibleMessageCountByTask = new Map();
    this.visibleSettingsTaskCountByKey = new Map();
    this.settingsTaskTab = "recent";
    this.lastRenderedActiveTaskId = null;
    this.pendingInitialPanelScrollKey = "";
    this.lastRenderedTaskMessageStateByTask = new Map();
    this.activeSelectableMessageEl = null;
    this.isClampingMessageSelection = false;
    this.taskListHovered = false;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "OpenAgent";
  }

  getIcon() {
    return "bot";
  }

  async onOpen() {
    const document = this.containerEl?.ownerDocument;
    if (document) {
      this.registerDomEvent(document, "selectionchange", () => this.handleMessageSelectionChange());
      this.registerDomEvent(document, "mouseup", () => this.clearActiveMessageSelection());
      this.registerDomEvent(document, "pointerup", () => this.clearActiveMessageSelection());
    }
    await this.plugin.refreshTasks();
    this.render();
  }

  clearActiveMessageSelection() {
    this.activeSelectableMessageEl = null;
  }

  bindMessageSelectionGuard(messageTextEl) {
    if (!messageTextEl) {
      return;
    }

    const activateMessageSelection = (event) => {
      if (event && typeof event.button === "number" && event.button !== 0) {
        return;
      }
      this.activeSelectableMessageEl = messageTextEl;
    };

    messageTextEl.addEventListener("mousedown", activateMessageSelection);
    messageTextEl.addEventListener("pointerdown", activateMessageSelection);
  }

  bindTaskListHoverGuard(taskListEl) {
    if (!taskListEl) {
      return;
    }

    taskListEl.addEventListener("mouseenter", () => {
      this.taskListHovered = true;
      this.plugin.setTaskListHovered(true);
    });
    taskListEl.addEventListener("mouseleave", () => {
      this.taskListHovered = false;
      this.plugin.setTaskListHovered(false);
    });
  }

  hasHoveredTaskList() {
    return this.taskListHovered === true;
  }

  handleMessageSelectionChange() {
    if (this.isClampingMessageSelection) {
      return;
    }

    const messageTextEl = this.activeSelectableMessageEl;
    if (!messageTextEl || !messageTextEl.isConnected) {
      this.activeSelectableMessageEl = null;
      return;
    }

    const document = messageTextEl.ownerDocument;
    const selection = document?.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    const startInside = messageTextEl.contains(range.startContainer);
    const endInside = messageTextEl.contains(range.endContainer);
    if (startInside && endInside) {
      return;
    }

    if (!range.intersectsNode(messageTextEl)) {
      return;
    }

    const clampedRange = range.cloneRange();
    if (!startInside) {
      clampedRange.setStart(messageTextEl, 0);
    }
    if (!endInside) {
      clampedRange.setEnd(messageTextEl, messageTextEl.childNodes.length);
    }

    this.isClampingMessageSelection = true;
    try {
      selection.removeAllRanges();
      selection.addRange(clampedRange);
    } finally {
      this.isClampingMessageSelection = false;
    }
  }

  captureComposerFocusState() {
    const input = this.composerInput;
    if (!input) {
      return null;
    }

    const activeElement = input.ownerDocument?.activeElement;
    if (activeElement !== input) {
      return null;
    }

    return {
      taskId: String(input.dataset.taskId || ""),
      selectionStart: typeof input.selectionStart === "number" ? input.selectionStart : null,
      selectionEnd: typeof input.selectionEnd === "number" ? input.selectionEnd : null,
      selectionDirection: input.selectionDirection || "none",
      scrollTop: input.scrollTop || 0,
    };
  }

  restoreComposerFocusState(focusState) {
    if (!focusState || !this.composerInput) {
      return;
    }

    if (String(this.composerInput.dataset.taskId || "") !== String(focusState.taskId || "")) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!this.composerInput) {
        return;
      }

      this.composerInput.focus();
      if (typeof focusState.selectionStart === "number" && typeof focusState.selectionEnd === "number") {
        try {
          this.composerInput.setSelectionRange(
            focusState.selectionStart,
            focusState.selectionEnd,
            focusState.selectionDirection
          );
        } catch {
          // Ignore selection restore failures on detached or unsupported inputs.
        }
      }
      this.composerInput.scrollTop = Number(focusState.scrollTop || 0);
    });
  }

  capturePanelScrollState() {
    const scrollEl = this.panelScrollEl;
    if (!scrollEl) {
      return null;
    }

    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const scrollTop = Number(scrollEl.scrollTop || 0);
    const distanceFromBottom = Math.max(0, maxScrollTop - scrollTop);
    return {
      key: this.panelScrollKey,
      scrollTop,
      atBottom: distanceFromBottom <= 32,
    };
  }

  restorePanelScrollState(scrollState, nextKey) {
    if (!scrollState || scrollState.key !== nextKey) {
      return;
    }

    window.requestAnimationFrame(() => {
      const scrollEl = this.panelScrollEl;
      if (!scrollEl || this.panelScrollKey !== nextKey) {
        return;
      }

      const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      scrollEl.scrollTop = scrollState.atBottom
        ? maxScrollTop
        : Math.min(Number(scrollState.scrollTop || 0), maxScrollTop);
    });
  }

  getLatestMessageState(task) {
    const taskId = String(task?.taskId || "");
    const messages = Array.isArray(task?.messages) ? task.messages : [];
    if (!taskId || messages.length === 0) {
      return {
        taskId,
        count: messages.length,
        lastIdentity: "",
        lastRole: "",
      };
    }

    const lastIndex = messages.length - 1;
    const lastMessage = messages[lastIndex];
    return {
      taskId,
      count: messages.length,
      lastIdentity: this.getMessageIdentity(lastMessage, lastIndex),
      lastRole: String(lastMessage?.role || ""),
    };
  }

  shouldAutoScrollToLatestUserMessage(task, options = {}) {
    if (options.didSwitchActiveTask === true) {
      return false;
    }

    const nextState = this.getLatestMessageState(task);
    if (!nextState.taskId || nextState.count === 0 || nextState.lastRole !== "user") {
      return false;
    }

    const previousState = this.lastRenderedTaskMessageStateByTask.get(nextState.taskId);
    if (!previousState) {
      return false;
    }

    return (
      nextState.count > previousState.count
      || nextState.lastIdentity !== previousState.lastIdentity
    );
  }

  rememberRenderedTaskMessageState(task) {
    const state = this.getLatestMessageState(task);
    if (!state.taskId) {
      return;
    }

    this.lastRenderedTaskMessageStateByTask.set(state.taskId, state);
  }

  scrollMessageIntoView(messageEl, nextKey) {
    if (!messageEl) {
      return;
    }

    window.requestAnimationFrame(() => {
      const scrollEl = this.panelScrollEl;
      if (!scrollEl || this.panelScrollKey !== nextKey || !messageEl.isConnected) {
        return;
      }

      messageEl.scrollIntoView({
        block: "end",
        inline: "nearest",
      });
    });
  }

  queueInitialPanelScroll(nextKey) {
    this.pendingInitialPanelScrollKey = String(nextKey || "").trim();
  }

  shouldInitialScrollToConversationEnd(nextKey) {
    return String(nextKey || "").trim() !== ""
      && this.pendingInitialPanelScrollKey === String(nextKey || "").trim();
  }

  consumeInitialPanelScroll(nextKey) {
    if (this.pendingInitialPanelScrollKey === String(nextKey || "").trim()) {
      this.pendingInitialPanelScrollKey = "";
    }
  }

  hasFocusedComposer() {
    const input = this.composerInput;
    return Boolean(input && input.ownerDocument?.activeElement === input);
  }

  getMessageIdentity(message, index) {
    return String(
      message?.id
      || message?.streamKey
      || `${message?.role || "system"}:${message?.kind || ""}:${message?.turnId || ""}:${message?.itemId || ""}:${index}`
    );
  }

  isToolMessage(message) {
    return String(message?.kind || "").trim() === "tool";
  }

  getToolMessagePreview(text) {
    const compact = String(text || "").replace(/\s+/g, " ").trim();
    return compact || "Tool output";
  }

  getDefaultVisibleMessageCount(totalMessages) {
    return Math.min(Math.max(Number(totalMessages) || 0, 0), CHAT_MESSAGE_PAGE_SIZE);
  }

  syncVisibleMessageCount(taskId, totalMessages, options = {}) {
    const normalizedTaskId = String(taskId || "");
    const normalizedTotal = Math.max(Number(totalMessages) || 0, 0);
    if (!normalizedTaskId) {
      return this.getDefaultVisibleMessageCount(normalizedTotal);
    }

    const defaultCount = this.getDefaultVisibleMessageCount(normalizedTotal);
    const currentCount = this.visibleMessageCountByTask.get(normalizedTaskId);
    if (options.reset === true || typeof currentCount !== "number" || currentCount <= 0) {
      this.visibleMessageCountByTask.set(normalizedTaskId, defaultCount);
      return defaultCount;
    }

    const nextCount = Math.max(defaultCount, Math.min(currentCount, normalizedTotal));
    this.visibleMessageCountByTask.set(normalizedTaskId, nextCount);
    return nextCount;
  }

  showOlderMessages(taskId, totalMessages) {
    const normalizedTaskId = String(taskId || "");
    if (!normalizedTaskId) {
      return;
    }

    const currentCount = this.syncVisibleMessageCount(normalizedTaskId, totalMessages);
    const nextCount = Math.min(Math.max(Number(totalMessages) || 0, 0), currentCount + CHAT_MESSAGE_PAGE_SIZE);
    if (nextCount === currentCount) {
      return;
    }

    this.visibleMessageCountByTask.set(normalizedTaskId, nextCount);
    this.render();
  }

  getDefaultVisibleSettingsTaskCount(totalTasks) {
    return Math.min(Math.max(Number(totalTasks) || 0, 0), SETTINGS_RECENT_TASKS_PAGE_SIZE);
  }

  syncVisibleSettingsTaskCount(listKey, totalTasks, options = {}) {
    const normalizedKey = String(listKey || "");
    const normalizedTotal = Math.max(Number(totalTasks) || 0, 0);
    if (!normalizedKey) {
      return this.getDefaultVisibleSettingsTaskCount(normalizedTotal);
    }

    const defaultCount = this.getDefaultVisibleSettingsTaskCount(normalizedTotal);
    const currentCount = this.visibleSettingsTaskCountByKey.get(normalizedKey);
    if (options.reset === true || typeof currentCount !== "number" || currentCount <= 0) {
      this.visibleSettingsTaskCountByKey.set(normalizedKey, defaultCount);
      return defaultCount;
    }

    const nextCount = Math.max(defaultCount, Math.min(currentCount, normalizedTotal));
    this.visibleSettingsTaskCountByKey.set(normalizedKey, nextCount);
    return nextCount;
  }

  showMoreSettingsTasks(listKey, totalTasks) {
    const normalizedKey = String(listKey || "");
    if (!normalizedKey) {
      return;
    }

    const currentCount = this.syncVisibleSettingsTaskCount(normalizedKey, totalTasks);
    const nextCount = Math.min(Math.max(Number(totalTasks) || 0, 0), currentCount + SETTINGS_RECENT_TASKS_PAGE_SIZE);
    if (nextCount === currentCount) {
      return;
    }

    this.visibleSettingsTaskCountByKey.set(normalizedKey, nextCount);
    this.render();
  }

  getSettingsTaskTab() {
    if (this.settingsTaskTab === "archived") {
      return "archived";
    }

    return this.settingsTaskTab === "running" ? "running" : "recent";
  }

  setSettingsTaskTab(tab) {
    const nextTab = tab === "archived"
      ? "archived"
      : (tab === "running" ? "running" : "recent");
    if (this.settingsTaskTab === nextTab) {
      return;
    }

    this.settingsTaskTab = nextTab;
    this.render();
  }

  renderTaskList(parentEl, tasks, options = {}) {
    if (!parentEl) {
      return;
    }

    const title = String(options.title || "").trim();
    if (title) {
      parentEl.createEl("h3", { text: title });
    }

    const displayedTasks = Array.isArray(tasks) ? tasks : [];
    const listEl = parentEl.createDiv({ cls: "oa-task-list" });
    this.bindTaskListHoverGuard(listEl);
    if (displayedTasks.length === 0) {
      listEl.createDiv({
        cls: "oa-muted",
        text: String(options.emptyText || "No threads yet."),
      });
      return;
    }

    const listKey = String(options.listKey || "").trim();
    const visibleTaskCount = options.enablePagination === false
      ? displayedTasks.length
      : this.syncVisibleSettingsTaskCount(listKey, displayedTasks.length, {
          reset: options.resetPagination === true,
        });
    const onTaskClick = typeof options.onTaskClick === "function"
      ? options.onTaskClick
      : ((task) => this.plugin.activateTaskFromList(task.taskId));
    const visibleTasks = displayedTasks.slice(0, visibleTaskCount);
    let previousDayKey = "";

    visibleTasks.forEach((task) => {
      const dayTimestamp = this.plugin.getTaskConversationLastMessageDayTimestamp(task);
      const dayKey = Number.isFinite(dayTimestamp) ? String(dayTimestamp) : "unknown";
      if (dayKey !== previousDayKey) {
        previousDayKey = dayKey;
        listEl.createEl("h4", {
          cls: "oa-task-list-date-heading",
          text: formatTaskListDayLabel(dayTimestamp),
        });
      }

      const item = listEl.createDiv({
        cls: `oa-task-item oa-thread-list-item${options.activeTask?.taskId === task.taskId ? " is-active" : ""}`,
      });
      const itemHeader = item.createDiv({ cls: "oa-task-item-header" });
      itemHeader.createDiv({ cls: "oa-task-title oa-thread-list-title", text: task.title || "Untitled task" });
      if (this.plugin.isTaskRunning(task)) {
        itemHeader.createDiv({
          cls: "oa-status-tag is-running",
          text: task.status || "running",
        });
      } else {
        itemHeader.createDiv({
          cls: "oa-thread-list-arrow",
          text: "→",
          attr: {
            "aria-hidden": "true",
          },
        });
      }

      item.addEventListener("click", () => {
        void onTaskClick(task);
      });
    });

    if (options.enablePagination === false || displayedTasks.length <= visibleTaskCount) {
      return;
    }

    const moreActions = parentEl.createDiv({ cls: "oa-action-row" });
    this.makeButton(
      moreActions,
      `Show more (${displayedTasks.length - visibleTaskCount} left)`,
      () => this.showMoreSettingsTasks(listKey, displayedTasks.length),
      false,
      { runOnMouseDown: true }
    );
  }

  renderGroupContextPreview(parentEl, preview) {
    if (!parentEl || !preview) {
      return;
    }

    const isLoading = preview.status === "loading";
    const textCount = Array.isArray(preview.textBlocks) ? preview.textBlocks.length : 0;
    const fileCount = Array.isArray(preview.markdownFiles) ? preview.markdownFiles.length : 0;
    const summaryText = isLoading
      ? `Loading group context from ${preview.canvasPath}...`
      : fileCount > 0
      ? `${fileCount} markdown file${fileCount === 1 ? "" : "s"} in ${preview.canvasPath}`
      : `No markdown file context found in ${preview.canvasPath}`;

    const card = parentEl.createDiv({ cls: "oa-task-item oa-group-context-card" });
    const cardHeader = card.createDiv({ cls: "oa-task-item-header" });
    cardHeader.createDiv({
      cls: "oa-task-title",
      text: `Group context: ${preview.groupLabel || "Untitled group"}`,
    });
    cardHeader.createDiv({
      cls: "oa-status-tag",
      text: isLoading ? "Loading" : "Preview",
    });

    card.createDiv({
      cls: "oa-task-meta",
      text: summaryText,
      attr: { title: preview.canvasPath },
    });

    const list = card.createDiv({ cls: "oa-group-context-list" });
    (preview.markdownFiles || []).slice(0, 4).forEach((file, index) => {
      const item = list.createDiv({ cls: "oa-group-context-item" });
      item.createDiv({ cls: "oa-group-context-label", text: `Markdown ${index + 1}` });
      item.createDiv({
        cls: "oa-group-context-value",
        text: String(file?.path || file?.name || "Untitled"),
        attr: file?.path ? { title: file.path } : {},
      });
    });
    if (isLoading && fileCount === 0) {
      list.createDiv({
        cls: "oa-muted",
        text: "Resolving markdown files in this group...",
      });
    }
    if ((preview.markdownFiles || []).length > 4) {
      list.createDiv({
        cls: "oa-muted",
        text: `And ${(preview.markdownFiles || []).length - 4} more markdown file${(preview.markdownFiles || []).length - 4 === 1 ? "" : "s"}.`,
      });
    }

    if (fileCount === 0 && textCount > 0) {
      list.createDiv({
        cls: "oa-muted",
        text: "This group has text nodes, but only markdown file nodes become default context.",
      });
    }

    if (Array.isArray(preview.warnings) && preview.warnings.length > 0) {
      preview.warnings.forEach((warning) => {
        card.createDiv({ cls: "oa-banner oa-banner-warning", text: warning });
      });
    }

    card.createDiv({
      cls: "oa-muted",
      text: "Select a text node inside this group to start a new thread with this group context.",
    });
  }

  render() {
    const composerFocusState = this.captureComposerFocusState();
    const panelScrollState = this.capturePanelScrollState();
    const { contentEl: rootEl } = this;
    rootEl.empty();
    rootEl.addClass("openagent-view");
    const activeCanvasPath = this.plugin.getActiveCanvasPath();
    const activeWorkspace = this.plugin.getActiveWorkspace();
    const tasks = this.plugin.getVisibleTasks();
    const archivedTasks = this.plugin.getArchivedTasks();
    const runningTasks = this.plugin.getRunningTasks();
    const activeTask = this.plugin.getActiveTask();
    const selectedGroupContextPreview = this.plugin.getSelectedGroupContextPreview();
    const workspaceSummariesLoading = this.plugin.isWorkspaceSummariesLoading();
    const activeTaskId = activeTask?.taskId ? String(activeTask.taskId) : "";
    const didSwitchActiveTask = Boolean(activeTaskId && activeTaskId !== this.lastRenderedActiveTaskId);
    const shouldAutoScrollToLatestUserMessage = this.shouldAutoScrollToLatestUserMessage(activeTask, {
      didSwitchActiveTask,
    });
    this.lastRenderedActiveTaskId = activeTaskId || null;
    const panelTab = this.plugin.getPanelTab();
    const isSettingsScreen = panelTab !== PANEL_TAB_OPTIONS.ACTIVE_TASK;
    const contentEl = rootEl.createDiv({ cls: `oa-panel-scroll${isSettingsScreen ? " is-settings-screen" : ""}` });
    this.panelScrollEl = contentEl;
    this.cwdInput = null;
    this.composerInput = null;
    const activeTaskArchived = activeTask ? this.plugin.isTaskArchived(activeTask) : false;
    const panelScrollKey = [
      panelTab,
      activeCanvasPath || "",
      panelTab === PANEL_TAB_OPTIONS.ACTIVE_TASK ? (activeTask?.taskId || "") : "",
    ].join(":");
    this.panelScrollKey = panelScrollKey;
    if (panelTab === PANEL_TAB_OPTIONS.ACTIVE_TASK && activeTaskId && didSwitchActiveTask) {
      this.queueInitialPanelScroll(panelScrollKey);
    }

    const header = contentEl.createDiv({ cls: "oa-header" });
    const headerTop = header.createDiv({ cls: "oa-header-top" });
    const brand = headerTop.createDiv({ cls: "oa-brand" });
    const logo = brand.createDiv({ cls: "oa-logo", attr: { "aria-hidden": "true" } });
    const logoDataUrl = this.plugin.getPluginLogoDataUrl();
    if (logoDataUrl) {
      logo.createEl("img", {
        cls: "oa-logo-image",
        attr: {
          src: logoDataUrl,
          alt: "",
        },
      });
    } else {
      logo.createSpan({ cls: "oa-logo-mark", text: "OA" });
    }
    const brandText = brand.createDiv({ cls: "oa-brand-text" });
    const brandTitleRow = brandText.createDiv({ cls: "oa-brand-title-row" });
    brandTitleRow.createEl("h2", { text: isSettingsScreen ? "Threads" : "OpenAgent" });
    if (this.plugin.getDaemonStatus().state === DAEMON_CONNECTION_STATES.ONLINE) {
      brandTitleRow.createSpan({
        cls: "oa-daemon-online-dot",
        attr: {
          "aria-label": "Daemon online",
          title: this.plugin.getDaemonStatusDetail() || "OpenAgent daemon is online.",
        },
      });
    }
    brandText.createDiv({
      cls: "oa-brand-subtitle",
      text: isSettingsScreen
        ? (activeWorkspace?.name || (workspaceSummariesLoading ? "Loading workspace..." : "Workspace and conversation controls"))
        : (activeTask?.cwd ? compactPathLabel(activeTask.cwd) : (activeWorkspace?.name || "Canvas-linked conversations")),
    });
    const actions = headerTop.createDiv({ cls: "oa-action-row oa-header-actions" });
    this.makeButton(actions, "Refresh", () => {
      void this.plugin.refreshTasks();
    });
    if (isSettingsScreen) {
      this.makeButton(actions, "Done", () => this.plugin.setPanelTab(PANEL_TAB_OPTIONS.ACTIVE_TASK));
    } else {
      if (activeCanvasPath) {
        this.makeButton(actions, "Arrange", () => this.plugin.autoArrangeActiveCanvas());
      }
      this.makeButton(actions, "Threads", () => this.plugin.setPanelTab(PANEL_TAB_OPTIONS.WORKSPACE_SETTINGS));
    }
    if (!isSettingsScreen && activeTask) {
      const headerConversation = header.createDiv({ cls: "oa-conversation-heading" });
      headerConversation.createDiv({ cls: "oa-detail-title", text: activeTask.title || "Untitled task" });
      headerConversation.createDiv({
        cls: `oa-status-tag${["running", "starting"].includes(String(activeTask.status || "")) ? " is-running" : ""}`,
        text: activeTask.status || "idle",
      });
    }
    if (this.plugin.runtimeIssue) {
      contentEl.createDiv({
        cls: "oa-banner oa-banner-error",
        text: this.plugin.runtimeIssue,
      });
    }

    if (isSettingsScreen) {
      const settingsBody = contentEl.createDiv({ cls: "oa-settings-body" });
      const settingsContent = settingsBody.createDiv({ cls: "oa-settings-page-content" });
      const workspaceBlock = settingsContent.createDiv({ cls: "oa-settings-section-block" });
      workspaceBlock.createEl("h3", {
        cls: "oa-settings-section-title",
        text: "Workspace",
      });
      const workspaceSection = workspaceBlock.createDiv({
        cls: "oa-settings-section oa-settings-card oa-workspace-settings-section",
      });
      const workspaceSummary = workspaceSection.createDiv({ cls: "oa-settings-list" });
      const workspaceRow = workspaceSummary.createDiv({ cls: "oa-settings-row" });
      workspaceRow.createDiv({ cls: "oa-settings-label", text: "Current workspace" });
      workspaceRow.createDiv({
        cls: "oa-settings-value oa-settings-value-path",
        text: activeWorkspace?.repoPath || (workspaceSummariesLoading ? "Loading workspace..." : "No workspace selected"),
        attr: activeWorkspace?.repoPath ? { title: activeWorkspace.repoPath } : {},
      });

      const workspaceActions = workspaceSection.createDiv({ cls: "oa-action-row" });
      const chooseWorkspaceButton = this.makeButton(workspaceActions, "New workspace", () => this.plugin.showWorkspacePicker());
      chooseWorkspaceButton.setCta();

      const daemonBlock = settingsContent.createDiv({ cls: "oa-settings-section-block" });
      daemonBlock.createEl("h3", {
        cls: "oa-settings-section-title",
        text: "Daemon",
      });
      const daemonSection = daemonBlock.createDiv({ cls: "oa-settings-section oa-settings-card" });
      const daemonSummary = daemonSection.createDiv({ cls: "oa-settings-list" });
      const daemonRow = daemonSummary.createDiv({ cls: "oa-settings-row" });
      daemonRow.createDiv({ cls: "oa-settings-label", text: "Connection" });
      const daemonValue = daemonRow.createDiv({ cls: "oa-settings-value oa-settings-value-stack" });
      daemonValue.createDiv({
        cls: `oa-status-tag ${this.plugin.getDaemonStatusTagClassName()}`.trim(),
        text: this.plugin.getDaemonStatusLabel(),
      });
      daemonValue.createDiv({
        cls: "oa-task-meta",
        text: this.plugin.getDaemonStatusDetail() || "Checks whether the local OpenAgent daemon responds to /health.",
      });

      const daemonActions = daemonSection.createDiv({ cls: "oa-action-row" });
      this.makeButton(daemonActions, "Refresh", () => {
        void this.plugin.refreshDaemonStatus({
          silent: false,
          forceRefresh: true,
        });
      }, false, {
        runOnMouseDown: true,
      });
      this.makeButton(daemonActions, "Start daemon", () => {
        void this.plugin.startDaemonWithFeedback();
      }, false, {
        runOnMouseDown: true,
      });

      const threadsBlock = settingsContent.createDiv({ cls: "oa-settings-section-block" });
      const threadsHeader = threadsBlock.createDiv({ cls: "oa-settings-section-header" });
      threadsHeader.createEl("h3", {
        cls: "oa-settings-section-title",
        text: activeCanvasPath ? "Threads" : "Tasks",
      });
      const threadTabs = threadsHeader.createDiv({ cls: "oa-settings-inline-tabs" });
      const settingsTaskTab = this.getSettingsTaskTab();
      [
        { id: "recent", label: "Recent" },
        { id: "running", label: "Running" },
        { id: "archived", label: "Archived" },
      ].forEach((tab) => {
        const button = threadTabs.createEl("button", {
          cls: `oa-settings-inline-tab${settingsTaskTab === tab.id ? " is-active" : ""}`,
          text: tab.label,
          attr: {
            type: "button",
            "aria-pressed": settingsTaskTab === tab.id ? "true" : "false",
          },
        });
        button.addEventListener("click", () => this.setSettingsTaskTab(tab.id));
      });

      const threadSection = threadsBlock.createDiv({ cls: "oa-task-section oa-settings-card" });
      const displayedTasks = settingsTaskTab === "archived"
        ? archivedTasks
        : (settingsTaskTab === "running" ? runningTasks : tasks);
      const taskListKey = [
        "workspace-settings",
        settingsTaskTab,
        activeCanvasPath || "",
        activeWorkspace?.repoPath || "",
      ].join(":");
      this.renderTaskList(threadSection, displayedTasks, {
        emptyText: settingsTaskTab === "archived"
          ? (activeCanvasPath
            ? "No archived thread yet for this canvas."
            : "No archived task yet.")
          : (settingsTaskTab === "running"
            ? (activeCanvasPath
              ? "No running thread for this canvas."
              : "No running task right now.")
            : (activeCanvasPath
              ? "No thread yet for this canvas. Select a node and start one."
              : "Open a Canvas and select a text node to work with its thread.")),
        listKey: taskListKey,
        activeTask,
      });

      this.restoreComposerFocusState(composerFocusState);
      this.restorePanelScrollState(panelScrollState, panelScrollKey);
      return;
    }

    const detail = contentEl.createDiv({ cls: "oa-detail-section" });

    if (!activeTask) {
      detail.addClass("is-empty-state");
      if (selectedGroupContextPreview) {
        this.renderGroupContextPreview(detail, selectedGroupContextPreview);
      } else {
        detail.createDiv({
          cls: "oa-muted",
          text: activeCanvasPath
            ? "Select a canvas node and start a conversation."
            : "Open a Canvas and select a node to start a conversation.",
        });
        const emptyActions = detail.createDiv({ cls: "oa-action-row" });
        this.makeButton(emptyActions, "New conversation", () => this.plugin.handleNewThreadFromSelectionCommand(), false, {
          runOnMouseDown: true,
        });
      }
      const emptyStateTasks = tasks.length > 0 ? tasks : archivedTasks;
      if (emptyStateTasks.length > 0) {
        const emptyStateTaskGroup = emptyStateTasks === archivedTasks ? "archived" : "recent";
        this.renderTaskList(detail, emptyStateTasks, {
          title: emptyStateTaskGroup === "archived"
            ? (activeCanvasPath ? "Archived threads" : "Archived tasks")
            : (activeCanvasPath ? "" : "Recent threads"),
          emptyText: activeCanvasPath
            ? "No thread yet for this canvas. Select a node and start one."
            : "Open a Canvas and select a node to start a conversation.",
          listKey: [
            "active-task-empty-state",
            emptyStateTaskGroup,
            activeCanvasPath || "",
            activeWorkspace?.repoPath || "",
          ].join(":"),
          activeTask,
        });
      }
      this.restorePanelScrollState(panelScrollState, panelScrollKey);
      return;
    }

    if (selectedGroupContextPreview) {
      this.renderGroupContextPreview(detail, selectedGroupContextPreview);
    }

    if (activeTaskArchived) {
      detail.createDiv({
        cls: "oa-banner oa-banner-warning",
        text: "Archived because its root Canvas node was deleted.",
      });
    }
    if (Array.isArray(activeTask.selectionContext?.warnings) && activeTask.selectionContext.warnings.length > 0) {
      activeTask.selectionContext.warnings.forEach((warning) => {
        detail.createDiv({ cls: "oa-banner oa-banner-warning", text: warning });
      });
    }

    if (activeTask.lastError) {
      detail.createDiv({ cls: "oa-banner oa-banner-error", text: activeTask.lastError });
    }

    const messagesSection = detail.createDiv({ cls: "oa-messages-section" });
    const messages = Array.isArray(activeTask.messages) ? activeTask.messages : [];
    const messagesLoaded = this.plugin.taskHasLoadedMessages(activeTask);
    const messageCount = Math.max(Number(activeTask.messageCount) || 0, messages.length);
    if (!messagesLoaded && messageCount > 0) {
      messagesSection.createDiv({
        cls: "oa-muted",
        text: `Loading conversation (${messageCount} messages)...`,
      });
      this.restorePanelScrollState(panelScrollState, panelScrollKey);
    } else if (messages.length === 0) {
      messagesSection.createDiv({ cls: "oa-muted", text: "No conversation yet." });
      this.restorePanelScrollState(panelScrollState, panelScrollKey);
    } else {
      const visibleMessageCount = this.syncVisibleMessageCount(activeTask.taskId, messages.length, {
        reset: didSwitchActiveTask,
      });
      const firstVisibleIndex = Math.max(0, messages.length - visibleMessageCount);
      const hiddenMessageCount = firstVisibleIndex;
      const shouldInitialScrollToConversationEnd = this.shouldInitialScrollToConversationEnd(panelScrollKey);
      let latestMessageEl = null;
      let latestUserMessageEl = null;
      if (hiddenMessageCount > 0) {
        const pagination = messagesSection.createDiv({ cls: "oa-message-pagination" });
        pagination.createDiv({
          cls: "oa-message-pagination-summary",
          text: `Showing ${visibleMessageCount} latest of ${messages.length} messages.`,
        });
        const paginationActions = pagination.createDiv({ cls: "oa-action-row oa-message-pagination-actions" });
        const nextVisibleCount = Math.min(messages.length, visibleMessageCount + CHAT_MESSAGE_PAGE_SIZE);
        const loadCount = nextVisibleCount - visibleMessageCount;
        this.makeButton(
          paginationActions,
          `Show ${loadCount} earlier`,
          () => this.showOlderMessages(activeTask.taskId, messages.length),
          false,
          { runOnMouseDown: true }
        );
      }

      const messageList = messagesSection.createDiv({ cls: "oa-message-list" });
      messages.slice(firstVisibleIndex).forEach((message, index) => {
        const messageIndex = firstVisibleIndex + index;
        const isToolMessage = this.isToolMessage(message);
        const item = messageList.createDiv({
          cls: `oa-message oa-chat-message oa-role-${message.role || "system"}${isToolMessage ? " oa-message-tool" : ""}`,
        });
        latestMessageEl = item;
        if (isToolMessage) {
          const messageKey = this.getMessageIdentity(message, messageIndex);
          const expanded = this.expandedToolMessages.has(messageKey);
          item.toggleClass("is-expanded", expanded);
          item.toggleClass("is-collapsed", !expanded);

          const toggle = item.createEl("button", {
            cls: "oa-message-toggle",
            attr: {
              type: "button",
              "aria-expanded": expanded ? "true" : "false",
            },
          });
          const toggleText = toggle.createDiv({ cls: "oa-message-toggle-text" });
          toggleText.createDiv({
            cls: "oa-message-preview",
            text: this.getToolMessagePreview(message.text),
          });
          toggle.createDiv({
            cls: "oa-message-toggle-icon",
            text: expanded ? "-" : "+",
          });

          const body = item.createDiv({
            cls: "oa-message-text",
            text: message.text || "",
          });
          this.bindMessageSelectionGuard(body);
          body.toggleClass("is-hidden", !expanded);

          toggle.addEventListener("click", () => {
            if (this.expandedToolMessages.has(messageKey)) {
              this.expandedToolMessages.delete(messageKey);
              item.removeClass("is-expanded");
              item.addClass("is-collapsed");
              toggle.setAttribute("aria-expanded", "false");
              body.addClass("is-hidden");
              const icon = toggle.querySelector(".oa-message-toggle-icon");
              if (icon) {
                icon.textContent = "+";
              }
              return;
            }

            this.expandedToolMessages.add(messageKey);
            item.removeClass("is-collapsed");
            item.addClass("is-expanded");
            toggle.setAttribute("aria-expanded", "true");
            body.removeClass("is-hidden");
            const icon = toggle.querySelector(".oa-message-toggle-icon");
            if (icon) {
              icon.textContent = "-";
            }
          });
          return;
        }

        const body = item.createDiv({
          cls: "oa-message-text",
          text: message.text || "",
        });
        this.bindMessageSelectionGuard(body);
        if (messageIndex === messages.length - 1 && String(message.role || "") === "user") {
          latestUserMessageEl = item;
        }
      });

      if (shouldInitialScrollToConversationEnd && latestMessageEl) {
        this.consumeInitialPanelScroll(panelScrollKey);
        this.scrollMessageIntoView(latestMessageEl, panelScrollKey);
      } else if (shouldAutoScrollToLatestUserMessage && latestUserMessageEl) {
        this.scrollMessageIntoView(latestUserMessageEl, panelScrollKey);
      } else {
        this.restorePanelScrollState(panelScrollState, panelScrollKey);
      }
    }

    const composer = rootEl.createDiv({ cls: "oa-composer-section" });
    const composerInputShell = composer.createDiv({ cls: "oa-composer-input-shell" });
    const taskIsRunning = this.plugin.isTaskRunning(activeTask);
    const canStopActiveTurn = Boolean(activeTask?.currentTurnId);
    this.composerInput = composerInputShell.createEl("textarea", { cls: "oa-composer-input" });
    this.composerInput.dataset.taskId = activeTask.taskId;
    this.composerInput.placeholder = "Add a follow-up message...";
    this.composerInput.rows = 2;
    this.composerInput.value = this.plugin.getDraft(activeTask.taskId);
    this.composerInput.addEventListener("focus", () => {
      this.plugin.setComposerFocused(true);
    });
    this.composerInput.addEventListener("input", (event) => {
      this.plugin.setDraft(activeTask.taskId, event.target.value);
    });
    this.composerInput.addEventListener("blur", () => {
      this.plugin.setComposerFocused(false);
      void this.plugin.persistPluginState();
    });
    this.composerInput.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        this.plugin.sendDraftForTask(activeTask.taskId, { draft: this.composerInput.value });
      }
    });

    const composerActionButton = composerInputShell.createEl("button", {
      cls: `oa-composer-action-button${canStopActiveTurn ? " is-stop" : " is-send"}`,
      text: canStopActiveTurn ? "Stop" : "↑",
      attr: {
        type: "button",
        "aria-label": canStopActiveTurn ? "Stop active task" : "Send message",
        title: canStopActiveTurn ? "Stop" : "Send",
      },
    });
    composerActionButton.disabled = !canStopActiveTurn && taskIsRunning;
    composerActionButton.addEventListener("click", () => {
      if (canStopActiveTurn) {
        void this.plugin.stopActiveTask();
        return;
      }
      this.plugin.sendDraftForTask(activeTask.taskId, { draft: this.composerInput?.value || "" });
    });

    this.restoreComposerFocusState(composerFocusState);
    this.rememberRenderedTaskMessageState(activeTask);
  }

  makeButton(container, label, onClick, disabled = false, options = {}) {
    const button = new ButtonComponent(container);
    button.setButtonText(label);
    button.setDisabled(Boolean(disabled));
    if (options.runOnMouseDown && button.buttonEl) {
      let ignoreNextClick = false;
      button.buttonEl.addEventListener("mousedown", (event) => {
        if (event.button !== 0 || button.buttonEl.disabled) {
          return;
        }

        event.preventDefault();
        ignoreNextClick = true;
        onClick();
      });
      button.buttonEl.addEventListener("click", (event) => {
        if (ignoreNextClick) {
          event.preventDefault();
          event.stopPropagation();
          ignoreNextClick = false;
          return;
        }

        onClick();
      });
      return button;
    }

    button.onClick(onClick);
    return button;
  }
}

class OpenAgentSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "OpenAgent" });

    new Setting(containerEl)
      .setName("Workspace root")
      .setDesc("Vault folder where OpenAgent creates one workspace folder per repo.")
      .addText((text) => {
        text
          .setPlaceholder("Workspaces")
          .setValue(this.plugin.settings.workspaceRoot)
          .onChange(async (value) => {
            this.plugin.settings.workspaceRoot = String(value || "").trim() || DEFAULT_SETTINGS.workspaceRoot;
            await this.plugin.persistPluginState();
          });
      });

    new Setting(containerEl)
      .setName("Daemon launch command")
      .setDesc("Optional. When the daemon is offline, OpenAgent will run this shell command and retry automatically.")
      .addText((text) => {
        text
          .setPlaceholder("cd /path/to/openagent && pnpm dev:daemon")
          .setValue(this.plugin.settings.daemonLaunchCommand)
          .onChange(async (value) => {
            this.plugin.settings.daemonLaunchCommand = String(value || "");
            await this.plugin.persistPluginState();
          });
      });

    new Setting(containerEl)
      .setName("Daemon launch directory")
      .setDesc("Optional working directory for the launch command above. Leave blank to use auto-discovery.")
      .addText((text) => {
        text
          .setPlaceholder("/absolute/path/to/openagent")
          .setValue(this.plugin.settings.daemonLaunchCwd)
          .onChange(async (value) => {
            this.plugin.settings.daemonLaunchCwd = String(value || "");
            await this.plugin.persistPluginState();
          });
      });

    new Setting(containerEl)
      .setName(`Daemon status: ${this.plugin.getDaemonStatusLabel()}`)
      .setDesc(this.plugin.getDaemonStatusDetail() || "Checks whether the local OpenAgent daemon responds to /health.")
      .addButton((button) => {
        button.setButtonText("Refresh");
        button.onClick(async () => {
          await this.plugin.refreshDaemonStatus({
            silent: false,
            forceRefresh: true,
          });
        });
      })
      .addButton((button) => {
        button.setButtonText("Start");
        button.onClick(async () => {
          await this.plugin.startDaemonWithFeedback();
        });
      });

    new Setting(containerEl)
      .setName("Codex sandbox mode")
      .setDesc("Choose how much access turns launched from this plugin get. Workspace-only stays inside the selected project folder. Full access removes the filesystem sandbox and should only be used for trusted work.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption(DAEMON_SANDBOX_MODE_OPTIONS.WORKSPACE_WRITE, "Workspace only (safer)")
          .addOption(DAEMON_SANDBOX_MODE_OPTIONS.DANGER_FULL_ACCESS, "Full access (advanced)")
          .setValue(normalizeDaemonSandboxMode(this.plugin.settings.daemonSandboxMode))
          .onChange(async (value) => {
            this.plugin.settings.daemonSandboxMode = normalizeDaemonSandboxMode(value);
            await this.plugin.persistPluginState();
            new Notice(`OpenAgent runtime mode: ${this.plugin.describeRuntimeConfig({ sandboxMode: value })}.`);
          });
      });

    containerEl.createDiv({
      cls: "oa-task-meta",
      text: getDaemonSandboxModeHelpText(this.plugin.settings.daemonSandboxMode),
    });

    new Setting(containerEl)
      .setName("Workspace")
      .setDesc("Create or open a workspace folder that points to a real repo on disk.")
      .addButton((button) => {
        button.setButtonText("New workspace");
        button.onClick(() => {
          this.plugin.showWorkspacePicker();
        });
      });

    new Setting(containerEl)
      .setName("Start daemon now")
      .setDesc("Useful after changing launch settings or if you want to warm it up before using Canvas.")
      .addButton((button) => {
        button.setButtonText("Start");
        button.onClick(async () => {
          await this.plugin.startDaemonWithFeedback();
        });
      });

    containerEl.createEl("h3", { text: "Developer options" });

    new Setting(containerEl)
      .setName("Enable smoke request polling")
      .setDesc("Developer only. Poll `.openagent/smoke-request.json` in the vault and execute smoke runs automatically.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.isDevSmokePollingEnabled())
          .onChange(async (value) => {
            this.plugin.settings.enableDevSmokeRequests = value === true;
            this.plugin.configureDevSmokePolling();
            await this.plugin.persistPluginState();
          });
      });

    new Setting(containerEl)
      .setName("Enable debug logging")
      .setDesc("Developer only. Record OpenAgent debug events and append them to `.openagent/new-thread-debug.jsonl` in the vault.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.isDebugLoggingEnabled())
          .onChange(async (value) => {
            this.plugin.settings.enableDebugLogging = value === true;
            if (!this.plugin.isDebugLoggingEnabled()) {
              this.plugin.debugEvents = [];
            }
            await this.plugin.persistPluginState();
            this.plugin.requestViewRefresh();
          });
      });
  }
}

module.exports = class OpenAgentPlugin extends Plugin {
  async onload() {
    const savedState = (await this.loadData()) || {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(savedState.settings || {}),
    };
    this.settings.daemonSandboxMode = normalizeDaemonSandboxMode(this.settings.daemonSandboxMode);
    this.uiState = {
      activeTaskId: savedState.uiState?.activeTaskId ?? savedState.activeTaskId ?? null,
      panelTab: normalizePanelTab(savedState.uiState?.panelTab ?? savedState.panelTab),
      draftsByTaskId: savedState.uiState?.draftsByTaskId ?? savedState.draftsByTaskId ?? {},
      canvasNodeHighlightStateByKey: savedState.uiState?.canvasNodeHighlightStateByKey ?? {},
    };
    const savedSyncState = savedState.syncState || {};
    this.daemonLauncher = new OpenAgentDaemonLauncher(this);
    this.api = new OpenAgentApiClient({
      daemonLauncher: this.daemonLauncher,
    });
    this.resolver = new CanvasSelectionResolver(this.app);
    this.runtimeIssue = "";
    this.tasksById = {};
    this.viewRefreshTimer = null;
    this.activeStreamDisposer = null;
    this.lastCanvasSelectionSnapshot = null;
    this.devSmokeRunPromise = null;
    this.lastProcessedSmokeRequestId = "";
    this.logoDataUrl = "";
    this.logoLoadPromise = null;
    this.debugEvents = [];
    this.devSmokePollIntervalId = null;
    this.daemonStatus = createDaemonStatusSnapshot({
      state: DAEMON_CONNECTION_STATES.CHECKING,
    });
    this.daemonStatusRefreshPromise = null;
    this.settingTab = null;
    this.resultNodeSyncStateByTaskId = normalizeResultNodeSyncState(
      savedSyncState.resultNodeSyncStateByTaskId
      || savedState.uiState?.resultNodeSyncStateByTaskId
      || {}
    );
    this.resultNodeSyncInFlight = new Set();
    this.canvasRunSourceRefByTaskId = normalizeCanvasRunSourceRefState(
      savedSyncState.canvasRunSourceRefByTaskId
      || savedState.uiState?.canvasRunSourceRefByTaskId
      || {}
    );
    this.canvasSnapshotCacheByPath = new Map();
    this.canvasMutationQueueByPath = new Map();
    this.canvasNodeHighlightSyncInFlight = new Set();
    this.canvasNodeHighlightSyncPending = new Set();
    this.canvasAutoRunInFlightByKey = new Set();
    this.taskDetailRefreshInFlight = new Set();
    this.composerFocused = false;
    this.taskListHovered = false;
    this.pendingViewRefresh = false;
    this.workspaceSummaryCacheByConfigPath = new Map();
    this.workspaceSummariesLoadPromise = null;
    this.workspaceSummariesLoaded = false;
    this.selectedGroupContextPreviewState = {
      key: "",
      preview: null,
      loading: false,
    };
    this.selectedGroupContextPreviewLoadPromise = null;

    this.registerView(VIEW_TYPE, (leaf) => new OpenAgentView(leaf, this));
    this.settingTab = new OpenAgentSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerInterval(window.setInterval(() => {
      this.captureCanvasSelectionSnapshot();
    }, SELECTION_SNAPSHOT_POLL_MS));
    this.configureDevSmokePolling();
    this.registerInterval(window.setInterval(() => {
      void this.refreshDaemonStatus({
        silent: true,
      });
    }, DAEMON_STATUS_POLL_MS));
    this.registerEvent(this.app.vault.on("create", (file) => {
      this.handleWorkspaceConfigMutation(file);
      this.handleSelectedGroupContextDependencyMutation(file);
      this.handleCanvasFileMutation(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      this.handleWorkspaceConfigMutation(file);
      this.handleSelectedGroupContextDependencyMutation(file);
      this.handleCanvasFileMutation(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.handleWorkspaceConfigMutation(file);
      this.handleSelectedGroupContextDependencyMutation(file);
      this.handleCanvasFileMutation(file);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.handleWorkspaceConfigMutation(file, oldPath);
      this.handleSelectedGroupContextDependencyMutation(file, oldPath);
      this.handleCanvasFileMutation(file);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      const activeCanvasPath = this.getActiveCanvasPath();
      if (activeCanvasPath) {
        this.getCanvasSnapshotSync(activeCanvasPath);
      }
      this.syncActiveTaskToCanvasContext();
      void this.refreshSelectedGroupContextPreview();
      this.requestViewRefresh();
    }));
    const initialCanvasPath = this.getActiveCanvasPath();
    if (initialCanvasPath) {
      this.getCanvasSnapshotSync(initialCanvasPath);
    }

    this.addCommand({
      id: "openagent-new-thread-from-selection",
      name: "New thread from selection",
      callback: () => this.handleNewThreadFromSelectionCommand(),
    });

    this.addCommand({
      id: "openagent-choose-repo-workspace",
      name: "Choose workspace",
      callback: () => this.showWorkspacePicker(),
    });

    this.addCommand({
      id: "openagent-open-panel",
      name: "Open tasks",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "openagent-resume-last-task",
      name: "Resume last task",
      callback: () => this.resumeLastTask(),
    });

    this.addCommand({
      id: "openagent-stop-active-task",
      name: "Stop active task",
      callback: () => this.stopActiveTask(),
    });

    this.addCommand({
      id: "openagent-auto-arrange-active-canvas",
      name: "Auto arrange active canvas",
      callback: () => this.autoArrangeActiveCanvas(),
    });

    this.addCommand({
      id: "openagent-start-daemon",
      name: "Start daemon",
      callback: () => {
        void this.startDaemonWithFeedback();
      },
    });

    this.addCommand({
      id: "openagent-create-follow-up-node",
      name: "Create follow-up node",
      callback: () => {
        void this.handleCreateFollowUpNodeCommand();
      },
    });

    this.app.workspace.onLayoutReady(() => {
      void this.ensurePanelVisibleOnStartup();
    });
    void this.ensureWorkspaceSummariesLoaded();
    void this.ensurePluginLogoDataUrlLoaded();
    void this.refreshDaemonStatus();
    void this.refreshTasks().catch(() => {});
  }

  async onunload() {
    this.disposeActiveStream();
    try {
      await this.persistPluginState();
    } catch {
      // Ignore persistence failures during plugin teardown.
    }
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.detach());
  }

  async persistPluginState() {
    await this.saveData({
      settings: this.settings,
      uiState: this.uiState,
      syncState: {
        resultNodeSyncStateByTaskId: this.resultNodeSyncStateByTaskId,
        canvasRunSourceRefByTaskId: this.canvasRunSourceRefByTaskId,
      },
    });
  }

  getSelectedSandboxMode() {
    return normalizeDaemonSandboxMode(this.settings?.daemonSandboxMode);
  }

  buildRuntimeConfigPayload(overrides = {}) {
    return {
      approvalPolicy: "never",
      sandboxMode: normalizeDaemonSandboxMode(overrides?.sandboxMode || this.getSelectedSandboxMode()),
    };
  }

  describeRuntimeConfig(runtimeConfig) {
    const sandboxMode = normalizeDaemonSandboxMode(runtimeConfig?.sandboxMode || this.getSelectedSandboxMode());
    const label = getDaemonSandboxModeLabel(sandboxMode);
    return sandboxMode === DAEMON_SANDBOX_MODE_OPTIONS.DANGER_FULL_ACCESS
      ? `${label} - can access files outside the selected folder`
      : `${label} - limited to the selected folder`;
  }

  getPluginLogoDataUrl() {
    return this.logoDataUrl;
  }

  async ensurePluginLogoDataUrlLoaded() {
    if (this.logoDataUrl) {
      return this.logoDataUrl;
    }

    if (this.logoLoadPromise) {
      return this.logoLoadPromise;
    }

    const logoPath = this.getPluginLogoPath();
    if (!logoPath) {
      return "";
    }

    this.logoLoadPromise = fs.promises.readFile(logoPath)
      .then((buffer) => {
        this.logoDataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
        this.requestViewRefresh();
        return this.logoDataUrl;
      })
      .catch(() => "")
      .finally(() => {
        this.logoLoadPromise = null;
      });

    return this.logoLoadPromise;
  }

  getPluginLogoPath() {
    const candidatePaths = [
      this.getManifestPluginPath(PLUGIN_LOGO_FILE_NAME),
      PLUGIN_LOGO_PATH,
    ].filter(Boolean);

    return candidatePaths.find((candidatePath) => fs.existsSync(candidatePath)) || "";
  }

  getManifestPluginPath(fileName) {
    const manifestDir = String(this.manifest?.dir || "").trim();
    if (!manifestDir) {
      return "";
    }

    const adapter = this.app.vault?.adapter;
    if (typeof adapter?.getBasePath !== "function") {
      return "";
    }

    return path.join(adapter.getBasePath(), manifestDir, fileName);
  }

  refreshSettingTab() {
    if (!this.settingTab?.containerEl?.isConnected || typeof this.settingTab.display !== "function") {
      return;
    }

    this.settingTab.display();
  }

  getStoredDaemonConfigSummary() {
    try {
      if (!fs.existsSync(DAEMON_CONFIG_PATH)) {
        return {
          host: "",
          port: "",
        };
      }

      const parsed = JSON.parse(fs.readFileSync(DAEMON_CONFIG_PATH, "utf8"));
      return {
        host: String(parsed?.host || "").trim(),
        port: String(parsed?.port || "").trim(),
      };
    } catch {
      return {
        host: "",
        port: "",
      };
    }
  }

  updateDaemonStatus(nextStatus, options = {}) {
    const previousStatus = this.daemonStatus || createDaemonStatusSnapshot();
    const normalizedStatus = createDaemonStatusSnapshot(nextStatus);
    const didChange = [
      "state",
      "host",
      "port",
      "error",
      "runtimeAvailable",
      "runtimeMessage",
      "lastRuntimeError",
    ].some((key) => previousStatus[key] !== normalizedStatus[key]);
    this.daemonStatus = normalizedStatus;

    if (didChange || options.forceRefresh === true) {
      this.requestViewRefresh();
      this.refreshSettingTab();
    }
  }

  getDaemonStatus() {
    return this.daemonStatus || createDaemonStatusSnapshot();
  }

  getDaemonStatusLabel() {
    const state = this.getDaemonStatus().state;
    if (state === DAEMON_CONNECTION_STATES.ONLINE) {
      return "Online";
    }
    if (state === DAEMON_CONNECTION_STATES.OFFLINE) {
      return "Offline";
    }
    if (state === DAEMON_CONNECTION_STATES.CHECKING) {
      return "Checking...";
    }
    return "Unknown";
  }

  getDaemonStatusTagClassName() {
    return getDaemonStatusTagClassName(this.getDaemonStatus().state);
  }

  getDaemonStatusDetail() {
    const status = this.getDaemonStatus();
    const endpoint = getDaemonEndpointLabel(status);
    const checkedAt = formatDaemonCheckedAt(status.checkedAt);
    const parts = [];

    if (status.state === DAEMON_CONNECTION_STATES.ONLINE) {
      if (endpoint) {
        parts.push(`Listening on ${endpoint}`);
      }
      if (status.runtimeAvailable === true) {
        parts.push("Codex runtime ready");
      } else if (status.runtimeMessage) {
        parts.push(status.runtimeMessage);
      }
      if (status.lastRuntimeError) {
        parts.push(`Last runtime error: ${status.lastRuntimeError}`);
      }
    } else if (status.state === DAEMON_CONNECTION_STATES.OFFLINE) {
      if (status.error) {
        parts.push(status.error);
      } else {
        parts.push("OpenAgent daemon is not responding.");
      }
      if (endpoint) {
        parts.push(`Expected ${endpoint}`);
      }
    } else if (status.state === DAEMON_CONNECTION_STATES.CHECKING) {
      parts.push(endpoint ? `Checking ${endpoint}` : "Checking the local daemon");
    } else {
      parts.push("Status has not been checked yet.");
    }

    if (checkedAt) {
      parts.push(`Checked ${checkedAt}`);
    }

    return parts.join(" - ");
  }

  async refreshDaemonStatus(options = {}) {
    if (this.daemonStatusRefreshPromise) {
      if (options.forceRefresh === true) {
        this.requestViewRefresh();
        this.refreshSettingTab();
      }
      return this.daemonStatusRefreshPromise;
    }

    const storedConfig = this.getStoredDaemonConfigSummary();
    if (options.silent !== true) {
      this.updateDaemonStatus({
        ...this.getDaemonStatus(),
        ...storedConfig,
        state: DAEMON_CONNECTION_STATES.CHECKING,
        error: "",
      }, {
        forceRefresh: true,
      });
    }

    this.daemonStatusRefreshPromise = this.api.getHealthOnce({
      reloadConfig: true,
    })
      .then((health) => {
        this.updateDaemonStatus({
          state: DAEMON_CONNECTION_STATES.ONLINE,
          checkedAt: Date.now(),
          host: String(health?.daemon?.host || storedConfig.host || "").trim(),
          port: String(health?.daemon?.port || storedConfig.port || "").trim(),
          error: "",
          runtimeAvailable: typeof health?.runtime?.ok === "boolean" ? health.runtime.ok : null,
          runtimeMessage: String(health?.runtime?.message || "").trim(),
          lastRuntimeError: String(health?.lastRuntimeError || "").trim(),
        }, {
          forceRefresh: options.forceRefresh === true,
        });
        return this.getDaemonStatus();
      })
      .catch((error) => {
        this.updateDaemonStatus({
          state: DAEMON_CONNECTION_STATES.OFFLINE,
          checkedAt: Date.now(),
          host: storedConfig.host,
          port: storedConfig.port,
          error: String(error?.message || error),
          runtimeAvailable: null,
          runtimeMessage: "",
          lastRuntimeError: "",
        }, {
          forceRefresh: options.forceRefresh === true || options.silent !== true,
        });
        return this.getDaemonStatus();
      })
      .finally(() => {
        this.daemonStatusRefreshPromise = null;
      });

    return this.daemonStatusRefreshPromise;
  }

  async startDaemonWithFeedback() {
    try {
      await this.daemonLauncher.ensureStarted();
      this.runtimeIssue = "";
      await this.refreshDaemonStatus({
        silent: false,
        forceRefresh: true,
      });
      new Notice("OpenAgent daemon is running.");
      return true;
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      await this.refreshDaemonStatus({
        silent: false,
        forceRefresh: true,
      }).catch(() => {});
      new Notice(this.runtimeIssue);
      this.requestViewRefresh();
      this.refreshSettingTab();
      return false;
    }
  }

  async pickDirectoryPath(options = {}) {
    const defaultPath = normalizeRepoPath(options.defaultPath) || os.homedir();
    const title = String(options.title || "Choose folder");
    const candidates = [];

    try {
      const electron = require("electron");
      if (electron?.remote?.dialog) {
        candidates.push(electron.remote.dialog);
      }
    } catch {
      // Ignore unavailable electron remote module.
    }

    try {
      const remote = require("@electron/remote");
      if (remote?.dialog) {
        candidates.push(remote.dialog);
      }
    } catch {
      // Ignore unavailable @electron/remote module.
    }

    for (const dialog of candidates) {
      if (typeof dialog?.showOpenDialogSync === "function") {
        const filePaths = dialog.showOpenDialogSync({
          title,
          defaultPath,
          properties: ["openDirectory", "createDirectory"],
        });
        if (Array.isArray(filePaths) && filePaths[0]) {
          return normalizeRepoPath(filePaths[0]);
        }
      }

      if (typeof dialog?.showOpenDialog === "function") {
        const result = await dialog.showOpenDialog({
          title,
          defaultPath,
          properties: ["openDirectory", "createDirectory"],
        });
        if (result && !result.canceled && Array.isArray(result.filePaths) && result.filePaths[0]) {
          return normalizeRepoPath(result.filePaths[0]);
        }
      }
    }

    throw new Error("Folder picker is not available in this Obsidian runtime yet. Paste the repo path for now.");
  }

  showWorkspacePicker() {
    new WorkspacePickerModal(this.app, this).open();
  }

  getVaultBasePath() {
    return this.resolver?.getVaultBasePath?.() || "";
  }

  getWorkspaceRootVaultPath() {
    return String(this.settings.workspaceRoot || DEFAULT_SETTINGS.workspaceRoot).trim() || DEFAULT_SETTINGS.workspaceRoot;
  }

  getWorkspaceConfigFiles() {
    return this.app.vault.getFiles().filter((file) => basenameVaultPath(file.path) === "workspace.json");
  }

  isWorkspaceSummariesLoading() {
    return Boolean(this.workspaceSummariesLoadPromise);
  }

  getWorkspaceSummarySignature(workspace) {
    if (!workspace) {
      return "";
    }

    return [
      workspace.configPath,
      workspace.folderPath,
      workspace.name,
      workspace.repoPath,
      workspace.defaultCanvas,
    ].join("|");
  }

  haveWorkspaceSummariesChanged(nextMap) {
    const previousMap = this.workspaceSummaryCacheByConfigPath;
    if (previousMap.size !== nextMap.size) {
      return true;
    }

    for (const [configPath, nextSummary] of nextMap.entries()) {
      if (this.getWorkspaceSummarySignature(previousMap.get(configPath)) !== this.getWorkspaceSummarySignature(nextSummary)) {
        return true;
      }
    }

    return false;
  }

  async readWorkspaceConfigSummary(file) {
    if (!(file instanceof TFile) || basenameVaultPath(file.path) !== "workspace.json") {
      return null;
    }

    try {
      const parsed = JSON.parse(await this.app.vault.cachedRead(file));
      const repoPath = normalizeRepoPath(parsed?.repoPath);
      if (!repoPath) {
        return null;
      }

      return {
        configPath: file.path,
        folderPath: dirnameVaultPath(file.path),
        name: String(parsed?.name || basenameVaultPath(dirnameVaultPath(file.path)) || "Workspace").trim(),
        repoPath,
        defaultCanvas: String(parsed?.defaultCanvas || "Main.canvas").trim() || "Main.canvas",
      };
    } catch {
      return null;
    }
  }

  async ensureWorkspaceSummariesLoaded(options = {}) {
    const force = options.force === true;
    if (!force && this.workspaceSummariesLoaded) {
      return this.listWorkspaceSummaries();
    }

    if (!force && this.workspaceSummariesLoadPromise) {
      return this.workspaceSummariesLoadPromise;
    }

    this.workspaceSummariesLoadPromise = (async () => {
      const nextMap = new Map();
      const summaries = await Promise.all(this.getWorkspaceConfigFiles().map((file) => this.readWorkspaceConfigSummary(file)));
      summaries.filter(Boolean).forEach((summary) => {
        nextMap.set(summary.configPath, summary);
      });

      const changed = this.haveWorkspaceSummariesChanged(nextMap);
      this.workspaceSummaryCacheByConfigPath = nextMap;
      this.workspaceSummariesLoaded = true;
      if (changed || force) {
        this.requestViewRefresh();
      }

      return this.listWorkspaceSummaries();
    })().finally(() => {
      this.workspaceSummariesLoadPromise = null;
    });

    return this.workspaceSummariesLoadPromise;
  }

  handleWorkspaceConfigMutation(file, oldPath = "") {
    const nextPath = file instanceof TFile ? String(file.path || "").trim() : "";
    const normalizedOldPath = String(oldPath || "").trim();
    if (basenameVaultPath(nextPath) !== "workspace.json" && basenameVaultPath(normalizedOldPath) !== "workspace.json") {
      return;
    }

    this.workspaceSummariesLoaded = false;
    void this.ensureWorkspaceSummariesLoaded({ force: true });
  }

  listWorkspaceSummaries() {
    return Array.from(this.workspaceSummaryCacheByConfigPath.values())
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getWorkspaceForVaultPath(vaultPath) {
    const normalizedPath = String(vaultPath || "").trim();
    if (!normalizedPath) {
      return null;
    }

    return this.listWorkspaceSummaries().find((workspace) => {
      return normalizedPath === workspace.folderPath || normalizedPath.startsWith(`${workspace.folderPath}/`);
    }) || null;
  }

  getActiveWorkspace() {
    const activeCanvasPath = this.getActiveCanvasPath();
    if (!activeCanvasPath) {
      return null;
    }

    return this.getWorkspaceForVaultPath(activeCanvasPath);
  }

  resolveWorkspaceRepoPathForSelection(selection) {
    const workspace = this.getWorkspaceForVaultPath(selection?.canvasPath);
    return workspace?.repoPath || "";
  }

  async ensureVaultFolderExists(vaultFolderPath) {
    const parts = String(vaultFolderPath || "").split("/").filter(Boolean);
    let currentPath = "";

    for (const part of parts) {
      currentPath = joinVaultPath(currentPath, part);
      if (!this.app.vault.getAbstractFileByPath(currentPath)) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  async writeVaultFile(vaultPath, content) {
    const existing = this.app.vault.getAbstractFileByPath(vaultPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return existing;
    }

    return this.app.vault.create(vaultPath, content);
  }

  buildDefaultWorkspaceCanvas(name, repoPath) {
    return JSON.stringify({
      nodes: [
        {
          id: "workspace-intro",
          type: "text",
          x: 80,
          y: 80,
          width: 440,
          height: 280,
          text: [
            `Workspace: ${name}`,
            `Repo: ${repoPath}`,
            "",
            "- One text node = one prompt/thread",
            "- Run: OpenAgent: New thread from selection",
            "- Shortcut helper: OpenAgent: Create follow-up node",
            "- Optional context: markdown file nodes, or markdown files in the same group",
            "- Follow-up: create a follow-up node from a previous OpenAgent node, then run again",
            "- OpenAgent writes the answer back to the canvas",
          ].join("\n"),
        },
      ],
      edges: [],
    }, null, 2) + "\n";
  }

  async createWorkspaceFromRepoPath(repoPathInput, workspaceNameInput = "") {
    const repoPath = normalizeRepoPath(repoPathInput);
    if (!repoPath) {
      throw new Error("Enter an absolute repo path.");
    }
    if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
      throw new Error(`Repo path does not exist: ${repoPath}`);
    }

    await this.ensureWorkspaceSummariesLoaded();
    const existing = this.listWorkspaceSummaries().find((workspace) => workspace.repoPath === repoPath);
    if (existing) {
      await this.openWorkspace(existing);
      new Notice(`Opened existing workspace: ${existing.name}`);
      return existing;
    }

    const workspaceRoot = this.getWorkspaceRootVaultPath();
    const workspaceName = String(workspaceNameInput || "").trim() || path.basename(repoPath);
    const baseFolderName = slugifyWorkspaceName(workspaceName);
    let folderPath = joinVaultPath(workspaceRoot, baseFolderName);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(joinVaultPath(folderPath, "workspace.json"))) {
      folderPath = joinVaultPath(workspaceRoot, `${baseFolderName}-${suffix}`);
      suffix += 1;
    }

    await this.ensureVaultFolderExists(folderPath);

    const workspace = {
      configPath: joinVaultPath(folderPath, "workspace.json"),
      folderPath,
      name: workspaceName,
      repoPath,
      defaultCanvas: "Main.canvas",
    };

    await this.writeVaultFile(workspace.configPath, JSON.stringify({
      name: workspace.name,
      repoPath: workspace.repoPath,
      defaultCanvas: workspace.defaultCanvas,
      createdAt: new Date().toISOString(),
    }, null, 2) + "\n");
    await this.writeVaultFile(
      joinVaultPath(folderPath, workspace.defaultCanvas),
      this.buildDefaultWorkspaceCanvas(workspace.name, workspace.repoPath)
    );

    await this.ensureWorkspaceSummariesLoaded({ force: true });
    await this.openWorkspace(workspace);
    new Notice(`Created workspace: ${workspace.name}`);
    return workspace;
  }

  async openWorkspace(workspace) {
    const canvasPath = joinVaultPath(workspace.folderPath, workspace.defaultCanvas || "Main.canvas");
    const canvasFile = this.app.vault.getAbstractFileByPath(canvasPath);
    if (!(canvasFile instanceof TFile)) {
      throw new Error(`Default canvas not found: ${canvasPath}`);
    }

    const leaf = this.app.workspace.getMostRecentLeaf() || this.app.workspace.getLeaf(true);
    await leaf.openFile(canvasFile);
    await this.activateView();
    await this.refreshTasks();
  }

  getDevSmokeAbsolutePath(relativePath) {
    const vaultBasePath = this.getVaultBasePath();
    if (!vaultBasePath) {
      return "";
    }

    return path.join(vaultBasePath, relativePath);
  }

  isDevSmokePollingEnabled() {
    return this.settings?.enableDevSmokeRequests === true;
  }

  isDebugLoggingEnabled() {
    return this.settings?.enableDebugLogging === true;
  }

  configureDevSmokePolling() {
    if (this.devSmokePollIntervalId != null) {
      window.clearInterval(this.devSmokePollIntervalId);
      this.devSmokePollIntervalId = null;
    }

    if (!this.isDevSmokePollingEnabled()) {
      void this.appendDebugEvent("dev_smoke_polling_configured", {
        enabled: false,
        requestPath: this.getDevSmokeAbsolutePath(DEV_SMOKE_REQUEST_RELATIVE_PATH),
      });
      return;
    }

    this.devSmokePollIntervalId = window.setInterval(() => {
      this.maybeRunDevSmokeRequest();
    }, DEV_SMOKE_POLL_MS);
    this.registerInterval(this.devSmokePollIntervalId);
    void this.appendDebugEvent("dev_smoke_polling_configured", {
      enabled: true,
      pollMs: DEV_SMOKE_POLL_MS,
      requestPath: this.getDevSmokeAbsolutePath(DEV_SMOKE_REQUEST_RELATIVE_PATH),
    });
    this.maybeRunDevSmokeRequest();
  }

  maybeRunDevSmokeRequest() {
    if (!this.isDevSmokePollingEnabled()) {
      return;
    }

    if (this.devSmokeRunPromise) {
      return;
    }

    this.devSmokeRunPromise = this.runDevSmokeRequest()
      .catch(() => {})
      .finally(() => {
        this.devSmokeRunPromise = null;
      });
  }

  async runDevSmokeRequest() {
    const requestPath = this.getDevSmokeAbsolutePath(DEV_SMOKE_REQUEST_RELATIVE_PATH);
    if (!requestPath || !fs.existsSync(requestPath)) {
      return;
    }

    let request;
    try {
      request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    } catch (error) {
      fs.unlinkSync(requestPath);
      await this.writeDevSmokeResult({
        status: "error",
        requestId: "",
        message: `Invalid smoke request: ${error.message}`,
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    const requestId = String(request?.id || "").trim() || `anonymous-${Date.now()}`;
    if (requestId === this.lastProcessedSmokeRequestId) {
      return;
    }
    this.lastProcessedSmokeRequestId = requestId;
    void this.appendDebugEvent("dev_smoke_request_detected", {
      requestId,
      canvasPath: String(request?.canvasPath || ""),
      mode: String(request?.mode || ""),
      runTask: request?.runTask !== false,
      forceNewTask: request?.forceNewTask === true,
    });

    try {
      let selection = await this.resolveDevSmokeSelection(request);
      const requestedCwd = this.normalizeWorkingDirectoryInput(request?.cwd);
      const smokeMode = String(request?.mode || "").trim();
      let task = null;
      let rawPrompt = "";
      let runMode = smokeMode || "default";

      if (request?.runTask !== false && smokeMode === "new-thread" && request?.forceNewTask === true) {
        const followUpResult = await this.runSelectionAsFollowUp(selection);
        if (followUpResult) {
          task = followUpResult.task;
          rawPrompt = followUpResult.message;
          runMode = "follow-up";
        }
      }

      if (!task) {
        if (request?.forceNewTask === true) {
          selection = await this.resolver.addImplicitCanvasMarkdownContext(selection);
        }

        const response = await this.api.createTaskFromCanvasSelection({
          ...selection,
          cwd: requestedCwd || this.resolver.inferWorkingDirectory(selection),
          forceNewTask: request?.forceNewTask === true,
          runtimeConfig: this.buildRuntimeConfigPayload(),
        });
        task = this.mergeTask(response.task);

        if (request?.runTask !== false) {
          if (smokeMode === "new-thread") {
            rawPrompt = this.getNewThreadPromptFromSelection(selection, {
              cwd: requestedCwd || this.resolver.inferWorkingDirectory(selection),
            });
            await this.api.runTask(task.taskId, {
              rawPrompt,
              transcriptMessage: rawPrompt,
              forceContext: false,
              runtimeConfig: this.buildRuntimeConfigPayload(),
            });
          } else {
            await this.api.runTask(task.taskId, {
              forceContext: true,
              runtimeConfig: this.buildRuntimeConfigPayload(),
            });
          }
        }
      }

      await this.refreshTask(task.taskId);

      await this.writeDevSmokeResult({
        status: "ok",
        requestId,
        taskId: task.taskId,
        cwd: task.cwd || requestedCwd || "",
        canvasPath: selection.canvasPath,
        nodeIds: selection.nodeIds,
        selectionSummary: this.summarizeSelection(selection),
        selectionDebug: this.describeSelectionDebug(selection),
        mode: runMode,
        rawPrompt,
        runTriggered: request?.runTask !== false,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.writeDevSmokeResult({
        status: "error",
        requestId,
        message: String(error?.message || error),
        finishedAt: new Date().toISOString(),
      });
    } finally {
      if (fs.existsSync(requestPath)) {
        fs.unlinkSync(requestPath);
      }
    }
  }

  async resolveDevSmokeSelection(request) {
    const canvasPath = String(request?.canvasPath || "").trim();
    if (!canvasPath) {
      throw new Error("Smoke request is missing canvasPath.");
    }

    const abstractFile = await this.waitForSmokeCanvasFile(canvasPath);
    if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
      throw new Error(`Smoke canvas not found: ${canvasPath}`);
    }

    const explicitNodeIds = Array.isArray(request?.nodeIds)
      ? request.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean)
      : [];
    const nodeIds = explicitNodeIds.length > 0
      ? explicitNodeIds
      : await this.resolveAllSupportedCanvasNodeIds(abstractFile);

    if (nodeIds.length === 0) {
      throw new Error(`Smoke canvas has no supported nodes: ${canvasPath}`);
    }

    return this.resolver.resolveCanvasSelection(abstractFile, nodeIds);
  }

  async waitForSmokeCanvasFile(canvasPath, options = {}) {
    const normalizedPath = String(canvasPath || "").trim();
    const timeoutMs = Math.max(0, toFiniteNumber(options.timeoutMs, 8_000));
    const pollMs = Math.max(25, toFiniteNumber(options.pollMs, 100));
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const abstractFile = this.app.vault.getAbstractFileByPath(normalizedPath);
      if (!normalizedPath || abstractFile instanceof TFile) {
        return abstractFile || null;
      }

      if (Date.now() >= deadline) {
        return abstractFile || null;
      }

      await sleep(pollMs);
    }
  }

  async resolveAllSupportedCanvasNodeIds(file) {
    const raw = await this.app.vault.cachedRead(file);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Unable to parse canvas JSON for ${file.path}`);
    }

    return Array.isArray(parsed?.nodes)
      ? parsed.nodes
        .filter((node) => node && (node.type === "text" || node.type === "file"))
        .map((node) => String(node.id || ""))
        .filter(Boolean)
      : [];
  }

  async writeDevSmokeResult(result) {
    const resultPath = this.getDevSmokeAbsolutePath(DEV_SMOKE_RESULT_RELATIVE_PATH);
    if (!resultPath) {
      return;
    }

    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  getDebugLogAbsolutePath() {
    return this.getDevSmokeAbsolutePath(DEBUG_LOG_RELATIVE_PATH);
  }

  getRecentDebugEvents() {
    return this.debugEvents.slice(-8).reverse();
  }

  async appendDebugEvent(type, payload = {}) {
    if (!this.isDebugLoggingEnabled()) {
      return null;
    }

    const event = {
      type: String(type || "event"),
      createdAt: new Date().toISOString(),
      payload,
      summary: this.formatDebugSummary(payload),
    };

    this.debugEvents.push(event);
    if (this.debugEvents.length > MAX_DEBUG_EVENTS) {
      this.debugEvents = this.debugEvents.slice(-MAX_DEBUG_EVENTS);
    }

    const debugPath = this.getDebugLogAbsolutePath();
    if (debugPath) {
      fs.mkdirSync(path.dirname(debugPath), { recursive: true });
      fs.appendFileSync(debugPath, `${JSON.stringify(event)}\n`, "utf8");
    }

    this.requestViewRefresh();
    return event;
  }

  formatDebugSummary(payload = {}) {
    return Object.entries(payload)
      .filter(([, value]) => value != null && value !== "")
      .map(([key, value]) => `${key}=${this.truncateInline(typeof value === "string" ? value : JSON.stringify(value), 180)}`)
      .join(" | ");
  }

  getTasks() {
    return Object.values(this.tasksById).sort((left, right) => {
      return (right.updatedAt || "").localeCompare(left.updatedAt || "");
    });
  }

  getTaskConversationLastMessageTimestamp(task) {
    const messages = Array.isArray(task?.messages) ? task.messages : [];
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastMessageTimestamp = parseIsoTimestamp(lastMessage?.updatedAt || lastMessage?.createdAt || "");
    if (lastMessageTimestamp != null) {
      return lastMessageTimestamp;
    }

    if (String(task?.lastMessageRole || "") === "assistant") {
      const latestAssistantTimestamp = parseIsoTimestamp(
        task?.latestAssistantMessage?.updatedAt || task?.latestAssistantMessage?.createdAt || ""
      );
      if (latestAssistantTimestamp != null) {
        return latestAssistantTimestamp;
      }
    }

    return parseIsoTimestamp(task?.updatedAt || task?.createdAt || "") || 0;
  }

  getTaskConversationLastMessageDayTimestamp(task) {
    return getStartOfLocalDayTimestamp(this.getTaskConversationLastMessageTimestamp(task));
  }

  getTaskRootNodeRef(task) {
    const canvasPath = this.getTaskCanvasPath(task);
    const bindingRootNodeIds = Array.isArray(task?.canvasBinding?.rootNodeIds)
      ? task.canvasBinding.rootNodeIds.map((nodeId) => String(nodeId)).filter(Boolean)
      : [];
    const selectionNodeIds = Array.isArray(task?.selectionContext?.nodeIds)
      ? task.selectionContext.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean)
      : [];
    const nodeIds = bindingRootNodeIds.length > 0 ? bindingRootNodeIds : selectionNodeIds;
    if (!canvasPath || nodeIds.length === 0) {
      return null;
    }

    const rootNodeId = this.getConversationSelectionNodeIds(canvasPath, [nodeIds[0]])[0] || nodeIds[0];
    if (!rootNodeId) {
      return null;
    }

    return {
      canvasPath,
      nodeId: rootNodeId,
    };
  }

  getTaskCanvasRunSourceRef(task) {
    const bindingCanvasPath = String(task?.canvasBinding?.canvasPath || "").trim();
    const bindingNodeId = String(task?.canvasBinding?.activeSourceNodeId || "").trim();
    if (bindingCanvasPath && bindingNodeId) {
      return {
        canvasPath: bindingCanvasPath,
        nodeId: bindingNodeId,
      };
    }

    const taskId = String(task?.taskId || "").trim();
    const override = taskId ? this.canvasRunSourceRefByTaskId[taskId] : null;
    const overrideCanvasPath = String(override?.canvasPath || "").trim();
    const overrideNodeId = String(override?.nodeId || "").trim();
    if (overrideCanvasPath && overrideNodeId) {
      return {
        canvasPath: overrideCanvasPath,
        nodeId: overrideNodeId,
      };
    }

    const canvasPath = String(task?.selectionContext?.canvasPath || "").trim();
    const nodeIds = Array.isArray(task?.selectionContext?.nodeIds)
      ? task.selectionContext.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean)
      : [];
    if (!canvasPath || nodeIds.length !== 1) {
      return null;
    }

    return {
      canvasPath,
      nodeId: nodeIds[0],
    };
  }

  cacheTaskCanvasRunSourceRef(taskId, ref) {
    const normalizedTaskId = String(taskId || "").trim();
    const normalizedCanvasPath = String(ref?.canvasPath || "").trim();
    const normalizedNodeId = String(ref?.nodeId || "").trim();
    if (!normalizedTaskId || !normalizedCanvasPath || !normalizedNodeId) {
      return null;
    }

    const previousRef = this.canvasRunSourceRefByTaskId[normalizedTaskId] || null;
    if (
      previousRef
      && String(previousRef.canvasPath || "") === normalizedCanvasPath
      && String(previousRef.nodeId || "") === normalizedNodeId
    ) {
      return {
        taskId: normalizedTaskId,
        canvasPath: normalizedCanvasPath,
        nodeId: normalizedNodeId,
      };
    }

    this.canvasRunSourceRefByTaskId[normalizedTaskId] = {
      canvasPath: normalizedCanvasPath,
      nodeId: normalizedNodeId,
    };

    const affectedCanvasPaths = new Set([
      String(previousRef?.canvasPath || "").trim(),
      normalizedCanvasPath,
    ].filter(Boolean));
    affectedCanvasPaths.forEach((canvasPath) => {
      this.scheduleCanvasNodeHighlightSync(canvasPath);
    });
    void this.persistPluginState();
    return {
      taskId: normalizedTaskId,
      canvasPath: normalizedCanvasPath,
      nodeId: normalizedNodeId,
    };
  }

  async setTaskCanvasRunSourceRef(taskId, ref, options = {}) {
    const cachedRef = this.cacheTaskCanvasRunSourceRef(taskId, ref);
    if (!cachedRef) {
      return this.tasksById[String(taskId || "").trim()] || null;
    }

    if (options.persistDaemon === false) {
      return this.tasksById[cachedRef.taskId] || null;
    }

    try {
      const response = await this.api.updateTaskCanvasBinding(cachedRef.taskId, {
        canvasPath: cachedRef.canvasPath,
        activeSourceNodeId: cachedRef.nodeId,
      });
      return this.mergeTask(response.task);
    } catch (error) {
      if (options.throwOnError) {
        throw error;
      }
      return this.tasksById[cachedRef.taskId] || null;
    }
  }

  findTaskByRootCanvasNode(canvasPath, nodeId) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedCanvasPath || !normalizedNodeId) {
      return null;
    }

    return this.getTasks().find((task) => {
      const rootRef = this.getTaskRootNodeRef(task);
      return rootRef?.canvasPath === normalizedCanvasPath && rootRef?.nodeId === normalizedNodeId;
    }) || null;
  }

  findTaskByCanvasRunSourceNode(canvasPath, nodeId) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedCanvasPath || !normalizedNodeId) {
      return null;
    }

    return this.getTasks().find((task) => {
      const sourceRef = this.getTaskCanvasRunSourceRef(task);
      return sourceRef?.canvasPath === normalizedCanvasPath && sourceRef?.nodeId === normalizedNodeId;
    }) || null;
  }

  findTaskByResultNode(canvasPath, resultNodeId, sourceNodeId) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedResultNodeId = String(resultNodeId || "").trim();
    const normalizedSourceNodeId = String(sourceNodeId || "").trim();
    if (!normalizedCanvasPath || !normalizedResultNodeId || !normalizedSourceNodeId) {
      return null;
    }

    return this.getTasks().find((task) => {
      if (this.getTaskCanvasPath(task) !== normalizedCanvasPath) {
        return false;
      }

      const boundResultNodeId = String(
        task?.canvasBinding?.resultNodesBySourceNodeId?.[normalizedSourceNodeId]?.resultNodeId || ""
      ).trim();
      if (boundResultNodeId) {
        return boundResultNodeId === normalizedResultNodeId;
      }

      return buildTaskResultNodeId(task.taskId, normalizedSourceNodeId) === normalizedResultNodeId;
    }) || null;
  }

  findTaskByOpenAgentResultNode(canvasPath, resultNodeId) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedResultNodeId = String(resultNodeId || "").trim();
    if (!normalizedCanvasPath || !normalizedResultNodeId) {
      return null;
    }

    const resultNode = this.readCanvasNodeByIdSync(normalizedCanvasPath, normalizedResultNodeId);
    if (!resultNode || !isOpenAgentAssistantResultNode(resultNode)) {
      return null;
    }

    const metadataTaskId = getOpenAgentResultTaskId(resultNode);
    const metadataTask = metadataTaskId ? this.tasksById[metadataTaskId] : null;
    if (metadataTask && this.getTaskCanvasPath(metadataTask) === normalizedCanvasPath) {
      return metadataTask;
    }

    const sourceNodeId = getOpenAgentResultSourceNodeId(resultNode)
      || this.getConversationSelectionNodeIds(normalizedCanvasPath, [normalizedResultNodeId])[0]
      || "";
    if (!sourceNodeId) {
      return null;
    }

    return this.findTaskByResultNode(normalizedCanvasPath, normalizedResultNodeId, sourceNodeId)
      || this.findTaskByCanvasRunSourceNode(normalizedCanvasPath, sourceNodeId)
      || this.findTaskByRootCanvasNode(normalizedCanvasPath, sourceNodeId)
      || null;
  }

  findConversationTaskForUpstreamNode(canvasPath, upstreamNodeId) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedUpstreamNodeId = String(upstreamNodeId || "").trim();
    if (!normalizedCanvasPath || !normalizedUpstreamNodeId) {
      return null;
    }

    const resultTask = this.findTaskByOpenAgentResultNode(normalizedCanvasPath, normalizedUpstreamNodeId);
    if (resultTask) {
      return resultTask;
    }

    if (normalizedUpstreamNodeId.startsWith("oa-result-")) {
      const sourceNodeId = this.getConversationSelectionNodeIds(normalizedCanvasPath, [normalizedUpstreamNodeId])[0] || "";
      if (!sourceNodeId) {
        return null;
      }

      return this.findTaskByResultNode(normalizedCanvasPath, normalizedUpstreamNodeId, sourceNodeId)
        || this.findTaskByCanvasRunSourceNode(normalizedCanvasPath, sourceNodeId)
        || this.findTaskByRootCanvasNode(normalizedCanvasPath, sourceNodeId)
        || null;
    }

    return this.findTaskByCanvasRunSourceNode(normalizedCanvasPath, normalizedUpstreamNodeId)
      || this.findTaskByRootCanvasNode(normalizedCanvasPath, normalizedUpstreamNodeId)
      || null;
  }

  async resolveCanvasFollowUpTarget(selection) {
    const canvasPath = String(selection?.canvasPath || "").trim();
    const nodeIds = Array.isArray(selection?.nodeIds)
      ? selection.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean)
      : [];
    const textBlocks = Array.isArray(selection?.textBlocks) ? selection.textBlocks : [];
    const markdownFiles = Array.isArray(selection?.markdownFiles) ? selection.markdownFiles : [];
    if (!canvasPath || nodeIds.length !== 1 || textBlocks.length !== 1 || markdownFiles.length > 0) {
      return null;
    }

    const followUpNodeId = nodeIds[0];
    const followUpMessage = String(textBlocks[0]?.text || "").trim();
    if (!followUpNodeId || !followUpMessage) {
      return null;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(canvasPath);
    if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(await this.app.vault.cachedRead(abstractFile));
    } catch {
      return null;
    }

    const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
    for (const edge of edges) {
      const toNodeId = String(edge?.toNode || "").trim();
      if (toNodeId !== followUpNodeId) {
        continue;
      }

      const upstreamNodeId = String(edge?.fromNode || "").trim();
      const task = this.findConversationTaskForUpstreamNode(canvasPath, upstreamNodeId);
      if (!task) {
        continue;
      }

      return {
        task,
        message: followUpMessage,
        sourceNodeId: followUpNodeId,
      };
    }

    return null;
  }

  async runSelectionAsFollowUp(selection) {
    const followUpTarget = await this.resolveCanvasFollowUpTarget(selection);
    if (!followUpTarget) {
      return null;
    }

    const task = followUpTarget.task;
    await this.setTaskCanvasRunSourceRef(task.taskId, {
      canvasPath: selection.canvasPath,
      nodeId: followUpTarget.sourceNodeId,
    }, {
      throwOnError: true,
    });

    const response = await this.api.sendMessage(
      task.taskId,
      followUpTarget.message,
      this.buildRuntimeConfigPayload()
    );

    return {
      task: this.mergeTask(response.task),
      message: followUpTarget.message,
    };
  }

  async handleCreateFollowUpNodeCommand() {
    try {
      const result = await this.createFollowUpNodeFromSelection();
      this.runtimeIssue = "";
      this.rememberSelectionSnapshot({
        canvasPath: result.canvasPath,
        nodeIds: [result.followUpNodeId],
      });
      await this.appendDebugEvent("canvas_follow_up_node_created", {
        canvasPath: result.canvasPath,
        selectedNodeId: result.selectedNodeId,
        anchorNodeId: result.anchorNodeId,
        followUpNodeId: result.followUpNodeId,
      });
      new Notice("Created a follow-up node. Select it, type your next request, then run OpenAgent: New thread from selection.");
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      await this.appendDebugEvent("canvas_follow_up_node_error", {
        message: this.runtimeIssue,
      });
      new Notice(this.runtimeIssue);
      this.requestViewRefresh({ force: true });
    }
  }

  async createFollowUpNodeFromSelection() {
    const view = this.resolver.getActiveCanvasView();
    if (!view) {
      throw new Error("Open a Canvas view first.");
    }

    const file = view.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "canvas") {
      throw new Error("The active view is not backed by a .canvas file.");
    }

    const selectedNodeIds = this.resolver.extractSelectedNodeIds(view).map((nodeId) => String(nodeId)).filter(Boolean);
    if (selectedNodeIds.length !== 1) {
      throw new Error("Select exactly one OpenAgent source or result node first.");
    }

    await this.resolver.flushPendingCanvasEdits(view);
    const selectedNodeId = selectedNodeIds[0];
    const result = await this.withSerializedCanvasMutation(file.path, async () => {
      const raw = await this.app.vault.cachedRead(file);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Unable to parse canvas JSON for ${file.path}`);
      }

      const nodes = Array.isArray(parsed?.nodes) ? [...parsed.nodes] : [];
      const edges = Array.isArray(parsed?.edges) ? [...parsed.edges] : [];
      const nodeById = new Map(
        nodes
          .map((node) => [String(node?.id || "").trim(), node])
          .filter(([nodeId]) => nodeId)
      );
      const selectedNode = nodeById.get(selectedNodeId) || null;
      if (!selectedNode) {
        throw new Error("The selected Canvas node could not be found.");
      }

      const anchor = this.resolveFollowUpAnchorForSelectedNode(file.path, selectedNodeId, nodeById);
      const followUpNodeId = createCanvasObjectId("oa-follow-up");
      const followUpNode = this.buildCanvasFollowUpNode(anchor.anchorNode, followUpNodeId, edges, nodeById);
      const followUpEdge = {
        id: createCanvasObjectId("oa-follow-up-edge"),
        fromNode: anchor.anchorNodeId,
        toNode: followUpNodeId,
        fromSide: "right",
        toSide: "left",
      };

      const nextParsed = {
        ...parsed,
        nodes: [...nodes, followUpNode],
        edges: [...edges, followUpEdge],
      };
      await this.app.vault.modify(file, JSON.stringify(nextParsed, null, 2) + "\n");
      this.primeCanvasSnapshot(file.path, nextParsed);
      return {
        canvasPath: file.path,
        selectedNodeId,
        anchorNodeId: anchor.anchorNodeId,
        followUpNodeId,
      };
    });

    this.scheduleCanvasNodeHighlightSync(file.path);
    this.requestViewRefresh({ force: true });
    return result;
  }

  resolveFollowUpAnchorForSelectedNode(canvasPath, selectedNodeId, nodeById) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeId = String(selectedNodeId || "").trim();
    const selectedNode = nodeById?.get(normalizedNodeId) || null;
    if (!normalizedCanvasPath || !normalizedNodeId || !selectedNode) {
      throw new Error("The selected Canvas node could not be found.");
    }

    if (isOpenAgentAssistantResultNode(selectedNode)) {
      const task = this.findTaskByOpenAgentResultNode(normalizedCanvasPath, normalizedNodeId);
      if (!task) {
        throw new Error("Select an existing OpenAgent source or result node first.");
      }

      return {
        task,
        anchorNodeId: normalizedNodeId,
        anchorNode: selectedNode,
      };
    }

    const task = this.findTaskByCanvasRunSourceNode(normalizedCanvasPath, normalizedNodeId)
      || this.findTaskByRootCanvasNode(normalizedCanvasPath, normalizedNodeId);
    if (!task) {
      throw new Error("Select an existing OpenAgent source or result node first.");
    }

    const resultNodeId = String(
      task?.canvasBinding?.resultNodesBySourceNodeId?.[normalizedNodeId]?.resultNodeId
      || buildTaskResultNodeId(task.taskId, normalizedNodeId)
    ).trim();
    const resultNode = resultNodeId ? nodeById?.get(resultNodeId) || null : null;
    if (resultNode && isOpenAgentAssistantResultNode(resultNode)) {
      return {
        task,
        anchorNodeId: resultNodeId,
        anchorNode: resultNode,
      };
    }

    return {
      task,
      anchorNodeId: normalizedNodeId,
      anchorNode: selectedNode,
    };
  }

  buildCanvasFollowUpNode(anchorNode, followUpNodeId, edges, nodeById) {
    const width = clampNumber(
      toFiniteNumber(anchorNode?.width, RESULT_NODE_DEFAULT_WIDTH),
      RESULT_NODE_MIN_WIDTH,
      RESULT_NODE_MAX_WIDTH
    );
    const x = toFiniteNumber(anchorNode?.x, 0) + toFiniteNumber(anchorNode?.width, width) + CANVAS_LAYOUT_X_GAP;
    const childNodes = (Array.isArray(edges) ? edges : [])
      .filter((edge) => String(edge?.fromNode || "").trim() === String(anchorNode?.id || "").trim())
      .map((edge) => nodeById?.get(String(edge?.toNode || "").trim()) || null)
      .filter(Boolean)
      .filter((node) => !isOpenAgentAssistantResultNode(node));
    const y = childNodes.length > 0
      ? childNodes.reduce((maxY, node) => {
          const nextBottom = toFiniteNumber(node?.y, 0) + toFiniteNumber(node?.height, FOLLOW_UP_NODE_DEFAULT_HEIGHT);
          return Math.max(maxY, nextBottom + RESULT_NODE_Y_GAP);
        }, toFiniteNumber(anchorNode?.y, 0))
      : toFiniteNumber(anchorNode?.y, 0);

    return {
      id: followUpNodeId,
      type: "text",
      x,
      y,
      width,
      height: FOLLOW_UP_NODE_DEFAULT_HEIGHT,
      text: "",
    };
  }

  readCanvasNodeIdSetSync(canvasPath, cache = new Map()) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    if (!normalizedCanvasPath) {
      return null;
    }

    if (cache.has(normalizedCanvasPath)) {
      return cache.get(normalizedCanvasPath);
    }

    const snapshot = this.getCanvasSnapshotSync(normalizedCanvasPath);
    if (!snapshot) {
      cache.set(normalizedCanvasPath, null);
      return null;
    }

    cache.set(normalizedCanvasPath, snapshot.nodeIds);
    return snapshot.nodeIds;
  }

  readCanvasNodeByIdSync(canvasPath, nodeId) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedCanvasPath || !normalizedNodeId) {
      return null;
    }

    const snapshot = this.getCanvasSnapshotSync(normalizedCanvasPath);
    return snapshot?.nodeById.get(normalizedNodeId) || null;
  }

  isTaskArchived(task, cache = new Map()) {
    const rootRef = this.getTaskRootNodeRef(task);
    if (!rootRef) {
      return false;
    }

    const nodeIds = this.readCanvasNodeIdSetSync(rootRef.canvasPath, cache);
    if (!nodeIds) {
      return false;
    }

    return !nodeIds.has(rootRef.nodeId);
  }

  getFilteredTasksByArchiveState(options = {}) {
    const activeCanvasPath = this.getActiveCanvasPath();
    const scopedCanvasPath = activeCanvasPath || "";
    const archiveState = options.archived === true;
    const archiveProbeCache = options.archiveProbeCache instanceof Map
      ? options.archiveProbeCache
      : new Map();
    const filteredTasks = this.getTasks().filter((task) => {
      if (scopedCanvasPath && this.getTaskCanvasPath(task) !== scopedCanvasPath) {
        return false;
      }

      return this.isTaskArchived(task, archiveProbeCache) === archiveState;
    });

    if (!scopedCanvasPath) {
      return filteredTasks;
    }

    const latestBySelection = new Map();
    filteredTasks.forEach((task) => {
      const key = this.getTaskSelectionIdentity(task);
      if (!key || latestBySelection.has(key)) {
        return;
      }
      latestBySelection.set(key, task);
    });
    return Array.from(latestBySelection.values());
  }

  getVisibleTasks(options = {}) {
    const archiveProbeCache = options.archiveProbeCache;
    return this.getFilteredTasksByArchiveState({ archived: false, archiveProbeCache });
  }

  getArchivedTasks(options = {}) {
    const archiveProbeCache = options.archiveProbeCache;
    return this.getFilteredTasksByArchiveState({ archived: true, archiveProbeCache });
  }

  getRunningTasks() {
    const activeCanvasPath = this.getActiveCanvasPath();
    return this.getTasks().filter((task) => {
      if (activeCanvasPath && this.getTaskCanvasPath(task) !== activeCanvasPath) {
        return false;
      }

      return this.isTaskRunning(task);
    });
  }

  getPanelTab() {
    return normalizePanelTab(this.uiState?.panelTab);
  }

  async setPanelTab(panelTab) {
    const nextPanelTab = normalizePanelTab(panelTab);
    if (this.uiState.panelTab === nextPanelTab) {
      this.requestViewRefresh();
      return;
    }

    this.uiState.panelTab = nextPanelTab;
    await this.persistPluginState();
    this.requestViewRefresh();
  }

  getActiveTask() {
    const task = this.tasksById[this.uiState.activeTaskId] || null;
    const activeCanvasPath = this.getActiveCanvasPath();
    if (!activeCanvasPath) {
      return task;
    }

    return this.getTaskCanvasPath(task) === activeCanvasPath ? task : null;
  }

  getDraft(taskId) {
    return this.uiState.draftsByTaskId?.[taskId] || "";
  }

  setDraft(taskId, value) {
    this.uiState.draftsByTaskId = this.uiState.draftsByTaskId || {};
    this.uiState.draftsByTaskId[taskId] = value;
  }

  clearDraft(taskId) {
    if (this.uiState.draftsByTaskId) {
      delete this.uiState.draftsByTaskId[taskId];
      this.persistPluginState();
    }
  }

  getCanvasNodeHighlightRef(task, archiveProbeCache = new Map()) {
    if (this.isTaskArchived(task, archiveProbeCache)) {
      return null;
    }

    return this.getTaskCanvasRunSourceRef(task);
  }

  getCanvasNodeHighlightKey(canvasPath, nodeId) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedCanvasPath || !normalizedNodeId) {
      return "";
    }

    return `${normalizedCanvasPath}\0${normalizedNodeId}`;
  }

  isTaskRunning(task) {
    return Boolean(task?.currentTurnId) || ["starting", "running"].includes(String(task?.status || ""));
  }

  maybeSyncCanvasNodeHighlights(task, previousTask) {
    const canvasPaths = new Set();
    const archiveProbeCache = new Map();
    [task, previousTask].forEach((entry) => {
      const ref = this.getCanvasNodeHighlightRef(entry, archiveProbeCache);
      if (ref?.canvasPath) {
        canvasPaths.add(ref.canvasPath);
      }
    });

    canvasPaths.forEach((canvasPath) => {
      this.scheduleCanvasNodeHighlightSync(canvasPath);
    });
  }

  reconcileAllCanvasNodeHighlights() {
    const canvasPaths = new Set();
    const archiveProbeCache = new Map();

    Object.values(this.tasksById).forEach((task) => {
      const ref = this.getCanvasNodeHighlightRef(task, archiveProbeCache);
      if (ref?.canvasPath) {
        canvasPaths.add(ref.canvasPath);
      }
    });

    Object.values(this.uiState.canvasNodeHighlightStateByKey || {}).forEach((entry) => {
      const canvasPath = String(entry?.canvasPath || "").trim();
      if (canvasPath) {
        canvasPaths.add(canvasPath);
      }
    });

    canvasPaths.forEach((canvasPath) => {
      this.scheduleCanvasNodeHighlightSync(canvasPath);
    });
  }

  getRunningCanvasNodeHighlightKeys(canvasPath) {
    const runningKeys = new Set();
    const archiveProbeCache = new Map();

    Object.values(this.tasksById).forEach((task) => {
      const ref = this.getCanvasNodeHighlightRef(task, archiveProbeCache);
      if (!ref || ref.canvasPath !== canvasPath || !this.isTaskRunning(task)) {
        return;
      }

      const key = this.getCanvasNodeHighlightKey(ref.canvasPath, ref.nodeId);
      if (key) {
        runningKeys.add(key);
      }
    });

    return runningKeys;
  }

  getCompletedCanvasNodeHighlightKeys(canvasPath) {
    const completedKeys = new Set();
    const archiveProbeCache = new Map();

    Object.values(this.tasksById).forEach((task) => {
      const ref = this.getCanvasNodeHighlightRef(task, archiveProbeCache);
      if (!ref || ref.canvasPath !== canvasPath || this.isTaskRunning(task)) {
        return;
      }

      const assistantMessage = this.getLatestAssistantMessage(task);
      if (
        String(task?.status || "") !== "idle"
        || !assistantMessage?.text?.trim()
        || !this.isLatestAssistantMessageCurrentForActiveSource(task, assistantMessage)
      ) {
        return;
      }

      const key = this.getCanvasNodeHighlightKey(ref.canvasPath, ref.nodeId);
      if (key) {
        completedKeys.add(key);
      }
    });

    return completedKeys;
  }

  getTrackedCanvasNodeHighlightKeys(canvasPath) {
    const trackedKeys = new Set();

    Object.keys(this.uiState.canvasNodeHighlightStateByKey || {}).forEach((key) => {
      const [trackedCanvasPath] = key.split("\0");
      if (trackedCanvasPath === canvasPath) {
        trackedKeys.add(key);
      }
    });

    return trackedKeys;
  }

  scheduleCanvasNodeHighlightSync(canvasPath) {
    if (!canvasPath) {
      return;
    }

    if (this.canvasNodeHighlightSyncInFlight.has(canvasPath)) {
      this.canvasNodeHighlightSyncPending.add(canvasPath);
      return;
    }

    this.canvasNodeHighlightSyncInFlight.add(canvasPath);
    void this.syncCanvasNodeHighlightsForCanvas(canvasPath)
      .catch(async (error) => {
        await this.appendDebugEvent("canvas_highlight_error", {
          canvasPath,
          message: String(error?.message || error),
        });
      })
      .finally(() => {
        this.canvasNodeHighlightSyncInFlight.delete(canvasPath);
        if (this.canvasNodeHighlightSyncPending.has(canvasPath)) {
          this.canvasNodeHighlightSyncPending.delete(canvasPath);
          this.scheduleCanvasNodeHighlightSync(canvasPath);
        }
      });
  }

  async syncCanvasNodeHighlightsForCanvas(canvasPath) {
    await this.withSerializedCanvasMutation(canvasPath, async () => {
      const runningKeys = this.getRunningCanvasNodeHighlightKeys(canvasPath);
      const completedKeys = this.getCompletedCanvasNodeHighlightKeys(canvasPath);
      const trackedKeys = this.getTrackedCanvasNodeHighlightKeys(canvasPath);
      if (runningKeys.size === 0 && completedKeys.size === 0 && trackedKeys.size === 0) {
        return;
      }

      const highlightStateByKey = this.uiState.canvasNodeHighlightStateByKey || {};
      const abstractFile = this.app.vault.getAbstractFileByPath(canvasPath);
      if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
        let stateChanged = false;
        trackedKeys.forEach((key) => {
          if (highlightStateByKey[key]) {
            delete highlightStateByKey[key];
            stateChanged = true;
          }
        });
        if (stateChanged) {
          await this.persistPluginState();
        }
        return;
      }

      const raw = await this.app.vault.cachedRead(abstractFile);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Unable to parse canvas JSON for ${canvasPath}`);
      }

      const nodes = Array.isArray(parsed?.nodes) ? [...parsed.nodes] : [];
      const relevantKeys = new Set([...runningKeys, ...completedKeys, ...trackedKeys]);
      const seenKeys = new Set();
      let nodesChanged = false;
      let stateChanged = false;

      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const nodeId = String(node?.id || "").trim();
        if (!nodeId) {
          continue;
        }

        const key = this.getCanvasNodeHighlightKey(canvasPath, nodeId);
        if (!relevantKeys.has(key)) {
          continue;
        }

        seenKeys.add(key);
        const shouldHighlight = runningKeys.has(key);
        const shouldMarkCompleted = !shouldHighlight && completedKeys.has(key);
        const hasColor = Object.prototype.hasOwnProperty.call(node, "color");
        const currentColor = hasColor ? String(node.color) : "";
        const storedState = highlightStateByKey[key] || null;

        if (shouldHighlight) {
          if (!storedState) {
            highlightStateByKey[key] = {
              canvasPath,
              nodeId,
              originalColor: hasColor ? node.color : null,
            };
            stateChanged = true;
          }

          if (!hasColor || currentColor !== RUNNING_CANVAS_NODE_COLOR) {
            nodes[index] = {
              ...node,
              color: RUNNING_CANVAS_NODE_COLOR,
            };
            nodesChanged = true;
          }
          continue;
        }

        if (shouldMarkCompleted) {
          if (!hasColor || String(node.color) !== COMPLETED_CANVAS_NODE_COLOR) {
            nodes[index] = {
              ...node,
              color: COMPLETED_CANVAS_NODE_COLOR,
            };
            nodesChanged = true;
          }

          if (storedState) {
            delete highlightStateByKey[key];
            stateChanged = true;
          }
          continue;
        }

        if (!storedState) {
          continue;
        }

        if (!hasColor || String(node.color) !== COMPLETED_CANVAS_NODE_COLOR) {
          nodes[index] = {
            ...node,
            color: COMPLETED_CANVAS_NODE_COLOR,
          };
          nodesChanged = true;
        }

        delete highlightStateByKey[key];
        stateChanged = true;
      }

      trackedKeys.forEach((key) => {
        if (seenKeys.has(key) || !highlightStateByKey[key]) {
          return;
        }

        delete highlightStateByKey[key];
        stateChanged = true;
      });

      if (nodesChanged) {
        parsed = {
          ...parsed,
          nodes,
        };
        await this.app.vault.modify(abstractFile, JSON.stringify(parsed, null, 2) + "\n");
        this.primeCanvasSnapshot(canvasPath, parsed);
      }

      if (stateChanged) {
        await this.persistPluginState();
      }
    });
  }

  mergeTask(task) {
    if (!task) {
      return null;
    }

    const previousTask = this.tasksById[task.taskId] || null;
    const nextTask = this.normalizeTaskForStore(task, previousTask);
    this.tasksById[nextTask.taskId] = nextTask;
    this.syncActiveTaskToCanvasContext();
    this.maybeSyncCanvasNodeHighlights(nextTask, previousTask);
    this.maybeSyncTaskResultNode(nextTask, previousTask);
    return nextTask;
  }

  taskHasLoadedMessages(task) {
    return Boolean(task) && task.messagesIncluded !== false;
  }

  normalizeTaskForStore(task, previousTask = null) {
    if (!task?.taskId) {
      return null;
    }

    const nextTask = {
      ...task,
    };
    const shouldReuseDetailedMessages = (
      nextTask.messagesIncluded === false
      && previousTask
      && previousTask.messagesIncluded !== false
      && String(previousTask.taskId || "") === String(this.uiState?.activeTaskId || "")
      && Array.isArray(previousTask.messages)
    );

    if (shouldReuseDetailedMessages) {
      nextTask.messages = previousTask.messages;
      nextTask.messagesIncluded = true;
    } else {
      nextTask.messages = Array.isArray(task.messages) ? task.messages : [];
      nextTask.messagesIncluded = task.messagesIncluded !== false;
    }

    if (typeof nextTask.messageCount !== "number") {
      nextTask.messageCount = nextTask.messages.length;
    }

    if (!nextTask.latestAssistantMessage && previousTask?.latestAssistantMessage) {
      nextTask.latestAssistantMessage = previousTask.latestAssistantMessage;
    }

    return nextTask;
  }

  getLatestAssistantMessage(task) {
    const messages = Array.isArray(task?.messages) ? task.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const text = String(message?.text || "");
      if (message?.role === "assistant" && text.trim()) {
        return {
          ...message,
          text,
        };
      }
    }

    const latestAssistantMessage = task?.latestAssistantMessage;
    const text = String(latestAssistantMessage?.text || "");
    if (text.trim()) {
      return {
        ...latestAssistantMessage,
        text,
      };
    }

    return null;
  }

  isLatestAssistantMessageCurrentForActiveSource(task, assistantMessage = null) {
    const candidate = assistantMessage || this.getLatestAssistantMessage(task);
    if (!candidate?.text?.trim()) {
      return false;
    }

    const activeSourceUpdatedAt = String(task?.canvasBinding?.activeSourceUpdatedAt || "").trim();
    if (!activeSourceUpdatedAt) {
      return true;
    }

    const assistantTimestamp = String(candidate.updatedAt || candidate.createdAt || "").trim();
    return !assistantTimestamp || assistantTimestamp >= activeSourceUpdatedAt;
  }

  getTaskResultSyncSignature(task) {
    const assistantMessage = this.getLatestAssistantMessage(task);
    if (!assistantMessage?.text?.trim() || !this.isLatestAssistantMessageCurrentForActiveSource(task, assistantMessage)) {
      return "";
    }

    const sourceRef = this.getTaskCanvasRunSourceRef(task);
    return stableShortHash(`${task?.taskId || ""}\0${sourceRef?.nodeId || ""}\0${assistantMessage.text}`);
  }

  getTaskResultNodeRef(task) {
    const sourceRef = this.getTaskCanvasRunSourceRef(task);
    const canvasPath = String(sourceRef?.canvasPath || "").trim();
    const sourceNodeId = String(sourceRef?.nodeId || "").trim();
    const boundResultNodeId = String(
      task?.canvasBinding?.resultNodesBySourceNodeId?.[sourceNodeId]?.resultNodeId || ""
    ).trim();
    const taskId = String(task?.taskId || "").trim();
    if (!canvasPath || !sourceNodeId || !taskId) {
      return null;
    }

    return {
      canvasPath,
      sourceNodeId,
      resultNodeId: boundResultNodeId || buildTaskResultNodeId(taskId, sourceNodeId),
    };
  }

  canSyncTaskResultNode(task, cache = new Map()) {
    const ref = this.getTaskResultNodeRef(task);
    if (!ref) {
      return false;
    }

    const nodeIds = this.readCanvasNodeIdSetSync(ref.canvasPath, cache);
    return Boolean(nodeIds?.has(ref.sourceNodeId));
  }

  doesTaskResultNodeExist(task, cache = new Map()) {
    const ref = this.getTaskResultNodeRef(task);
    if (!ref) {
      return false;
    }

    const nodeIds = this.readCanvasNodeIdSetSync(ref.canvasPath, cache);
    return Boolean(nodeIds?.has(ref.resultNodeId));
  }

  doesTaskResultNodeHaveCurrentMetadata(task, signature) {
    const ref = this.getTaskResultNodeRef(task);
    if (!ref) {
      return false;
    }

    const resultNode = this.readCanvasNodeByIdSync(ref.canvasPath, ref.resultNodeId);
    const metadata = getOpenAgentCanvasMetadata(resultNode);
    return Boolean(
      metadata?.kind === "assistant-result"
      && String(metadata.taskId || "") === String(task?.taskId || "")
      && String(metadata.sourceNodeId || "") === ref.sourceNodeId
      && String(metadata.syncSignature || "") === String(signature || "")
    );
  }

  shouldAutoSyncTaskResultNode(task, previousTask) {
    const selection = task?.selectionContext;
    const nodeIds = Array.isArray(selection?.nodeIds)
      ? selection.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean)
      : [];
    const textBlocks = Array.isArray(selection?.textBlocks) ? selection.textBlocks : [];
    const markdownFiles = Array.isArray(selection?.markdownFiles) ? selection.markdownFiles : [];
    const hasSingleSupportedSource = (
      (textBlocks.length === 1)
      || (textBlocks.length === 0 && markdownFiles.length === 1)
    );
    if (nodeIds.length !== 1 || !hasSingleSupportedSource) {
      return false;
    }

    if (String(task?.status || "") !== "idle" || task?.currentTurnId) {
      return false;
    }

    const canvasNodeCache = new Map();
    if (!this.canSyncTaskResultNode(task, canvasNodeCache)) {
      return false;
    }

    const signature = this.getTaskResultSyncSignature(task);
    if (!signature) {
      return false;
    }

    const resultNodeExists = this.doesTaskResultNodeExist(task, canvasNodeCache);
    const resultNodeMetadataCurrent = resultNodeExists
      ? this.doesTaskResultNodeHaveCurrentMetadata(task, signature)
      : false;
    if (
      this.resultNodeSyncStateByTaskId[task.taskId] === signature
      && resultNodeExists
      && resultNodeMetadataCurrent
    ) {
      return false;
    }

    if (resultNodeExists && !resultNodeMetadataCurrent) {
      return true;
    }

    if (
      previousTask
      && (
      previousTask.currentTurnId
      || ["starting", "running"].includes(String(previousTask.status || ""))
      )
    ) {
      return true;
    }

    return !resultNodeExists;
  }

  maybeSyncTaskResultNode(task, previousTask) {
    if (!this.shouldAutoSyncTaskResultNode(task, previousTask)) {
      return;
    }

    if (this.resultNodeSyncInFlight.has(task.taskId)) {
      return;
    }

    const signature = this.getTaskResultSyncSignature(task);
    if (!signature) {
      return;
    }

    this.resultNodeSyncInFlight.add(task.taskId);
    void this.syncTaskResultNode(task, signature)
      .catch((error) => {
        const message = String(error?.message || error);
        void this.appendDebugEvent("canvas_result_error", {
          taskId: task.taskId,
          message,
        });
        new Notice(`Unable to write the Canvas result node: ${message}`);
      })
      .finally(() => {
        this.resultNodeSyncInFlight.delete(task.taskId);
      });
  }

  async syncTaskResultNode(task, signature) {
    const assistantMessage = this.getLatestAssistantMessage(task);
    const result = await this.upsertCanvasResultNode(task, assistantMessage, signature);
    const bindingResponse = await this.api.updateTaskCanvasBinding(task.taskId, {
      canvasPath: result.canvasPath,
      activeSourceNodeId: result.sourceNodeId,
      resultNode: {
        sourceNodeId: result.sourceNodeId,
        resultNodeId: result.resultNodeId,
        edgeId: result.edgeId,
        messageId: String(assistantMessage?.id || ""),
        syncSignature: signature,
      },
    });
    this.mergeTask(bindingResponse.task);
    this.resultNodeSyncStateByTaskId[task.taskId] = signature;
    await this.persistPluginState();
    await this.appendDebugEvent("canvas_result_synced", {
      taskId: task.taskId,
      canvasPath: result.canvasPath,
      sourceNodeId: result.sourceNodeId,
      resultNodeId: result.resultNodeId,
    });
    new Notice("Created a linked Canvas result node.");
  }

  async upsertCanvasResultNode(task, assistantMessage, signature = "") {
    const sourceRef = this.getTaskCanvasRunSourceRef(task);
    const canvasPath = String(sourceRef?.canvasPath || task?.selectionContext?.canvasPath || "").trim();
    const sourceNodeId = String(sourceRef?.nodeId || task?.selectionContext?.nodeIds?.[0] || "").trim();
    if (!canvasPath || !sourceNodeId) {
      throw new Error("Task is missing the Canvas source node.");
    }

    const normalizedText = String(assistantMessage?.text || assistantMessage || "").trim();
    if (!normalizedText) {
      throw new Error("There is no assistant result to write back into the Canvas.");
    }

    return this.withSerializedCanvasMutation(canvasPath, async () => {
      const abstractFile = this.app.vault.getAbstractFileByPath(canvasPath);
      if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
        throw new Error(`Canvas file not found: ${canvasPath}`);
      }

      const raw = await this.app.vault.cachedRead(abstractFile);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Unable to parse canvas JSON for ${canvasPath}`);
      }

      const nodes = Array.isArray(parsed?.nodes) ? [...parsed.nodes] : [];
      const edges = Array.isArray(parsed?.edges) ? [...parsed.edges] : [];
      const sourceNodeIndex = nodes.findIndex((node) => String(node?.id || "") === sourceNodeId);
      if (sourceNodeIndex < 0) {
        throw new Error(`Source Canvas node is missing: ${sourceNodeId}`);
      }

      const sourceNode = nodes[sourceNodeIndex] || {};
      const nextSourceNode = {
        ...sourceNode,
        color: COMPLETED_CANVAS_NODE_COLOR,
      };
      nodes[sourceNodeIndex] = nextSourceNode;
      const resultNodeId = buildTaskResultNodeId(task.taskId, sourceNodeId);
      const edgeId = `oa-edge-${stableShortHash(`${sourceNodeId}\0${task.taskId}`)}`;
      const existingResultNodeIndex = nodes.findIndex((node) => String(node?.id || "") === resultNodeId);
      const existingResultNode = existingResultNodeIndex >= 0 ? nodes[existingResultNodeIndex] : null;
      const resultMetadata = {
        ...(getOpenAgentCanvasMetadata(existingResultNode) || {}),
        schemaVersion: OPENAGENT_CANVAS_SCHEMA_VERSION,
        kind: "assistant-result",
        taskId: String(task.taskId || ""),
        threadId: String(task.threadId || ""),
        sourceNodeId,
        messageId: String(assistantMessage?.id || ""),
        syncSignature: String(signature || this.getTaskResultSyncSignature(task) || ""),
      };

      const defaultWidth = clampNumber(
        toFiniteNumber(existingResultNode?.width, toFiniteNumber(sourceNode.width, RESULT_NODE_DEFAULT_WIDTH)),
        RESULT_NODE_MIN_WIDTH,
        RESULT_NODE_MAX_WIDTH
      );
      const defaultX = toFiniteNumber(sourceNode.x, 0);
      const siblingResultNodes = edges
        .filter((edge) => String(edge?.fromNode || "") === sourceNodeId)
        .map((edge) => nodes.find((node) => String(node?.id || "") === String(edge?.toNode || "")))
        .filter((node) => node && String(node.id || "") !== resultNodeId && isOpenAgentAssistantResultNode(node));
      const defaultY = siblingResultNodes.length > 0
        ? siblingResultNodes.reduce((maxY, node) => {
            const nextBottom = toFiniteNumber(node.y, toFiniteNumber(sourceNode.y, 0)) + toFiniteNumber(node.height, RESULT_NODE_MIN_HEIGHT);
            return Math.max(maxY, nextBottom + RESULT_NODE_Y_GAP);
          }, toFiniteNumber(sourceNode.y, 0) + toFiniteNumber(sourceNode.height, RESULT_NODE_MIN_HEIGHT) + RESULT_NODE_Y_GAP)
        : toFiniteNumber(sourceNode.y, 0) + toFiniteNumber(sourceNode.height, RESULT_NODE_MIN_HEIGHT) + RESULT_NODE_Y_GAP;
      const resultNode = {
        ...(existingResultNode || {}),
        id: resultNodeId,
        type: "text",
        x: existingResultNode ? toFiniteNumber(existingResultNode.x, defaultX) : defaultX,
        y: existingResultNode ? toFiniteNumber(existingResultNode.y, defaultY) : defaultY,
        width: existingResultNode ? clampNumber(toFiniteNumber(existingResultNode.width, defaultWidth), RESULT_NODE_MIN_WIDTH, RESULT_NODE_MAX_WIDTH) : defaultWidth,
        height: estimateCanvasTextNodeHeight(
          normalizedText,
          existingResultNode ? toFiniteNumber(existingResultNode.width, defaultWidth) : defaultWidth
        ),
        text: normalizedText,
        openagent: resultMetadata,
      };

      if (existingResultNodeIndex >= 0) {
        nodes[existingResultNodeIndex] = resultNode;
      } else {
        nodes.push(resultNode);
      }

      const existingEdgeIndex = edges.findIndex((edge) => (
        String(edge?.id || "") === edgeId
        || (
          String(edge?.fromNode || "") === sourceNodeId
          && String(edge?.toNode || "") === resultNodeId
        )
      ));
      const edge = {
        ...(existingEdgeIndex >= 0 ? edges[existingEdgeIndex] : {}),
        id: edgeId,
        fromNode: sourceNodeId,
        toNode: resultNodeId,
        fromSide: existingEdgeIndex >= 0 ? String(edges[existingEdgeIndex]?.fromSide || "bottom") : "bottom",
        toSide: existingEdgeIndex >= 0 ? String(edges[existingEdgeIndex]?.toSide || "top") : "top",
        openagent: {
          ...(existingEdgeIndex >= 0 ? getOpenAgentCanvasMetadata(edges[existingEdgeIndex]) || {} : {}),
          schemaVersion: OPENAGENT_CANVAS_SCHEMA_VERSION,
          kind: "result-edge",
          taskId: String(task.taskId || ""),
          threadId: String(task.threadId || ""),
          sourceNodeId,
          resultNodeId,
        },
      };

      if (existingEdgeIndex >= 0) {
        edges[existingEdgeIndex] = edge;
      } else {
        edges.push(edge);
      }

      parsed = {
        ...parsed,
        nodes,
        edges,
      };
      await this.app.vault.modify(abstractFile, JSON.stringify(parsed, null, 2) + "\n");
      this.primeCanvasSnapshot(canvasPath, parsed);

      return {
        canvasPath,
        sourceNodeId,
        resultNodeId,
        edgeId,
      };
    });
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }

    this.app.workspace.revealLeaf(leaf);
    this.requestViewRefresh();
  }

  getTaskJumpNodeRef(task) {
    if (!task) {
      return null;
    }

    const assistantMessage = this.getLatestAssistantMessage(task);
    const resultRef = this.getTaskResultNodeRef(task);
    if (
      resultRef
      && assistantMessage?.text?.trim()
      && this.isLatestAssistantMessageCurrentForActiveSource(task, assistantMessage)
      && this.readCanvasNodeByIdSync(resultRef.canvasPath, resultRef.resultNodeId)
    ) {
      return {
        canvasPath: resultRef.canvasPath,
        nodeId: resultRef.resultNodeId,
      };
    }

    const sourceRef = this.getTaskCanvasRunSourceRef(task);
    if (sourceRef && this.readCanvasNodeByIdSync(sourceRef.canvasPath, sourceRef.nodeId)) {
      return sourceRef;
    }

    const rootRef = this.getTaskRootNodeRef(task);
    if (rootRef && this.readCanvasNodeByIdSync(rootRef.canvasPath, rootRef.nodeId)) {
      return rootRef;
    }

    return sourceRef || rootRef || null;
  }

  findCanvasLeafByPath(canvasPath) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    if (!normalizedCanvasPath) {
      return null;
    }

    return this.app.workspace.getLeavesOfType("canvas").find((leaf) => {
      return String(leaf?.view?.file?.path || "").trim() === normalizedCanvasPath;
    }) || null;
  }

  findCanvasRuntimeNodeById(canvas, nodeId) {
    const normalizedNodeId = String(nodeId || "").trim();
    if (!canvas || !normalizedNodeId) {
      return null;
    }

    const getCandidateNodeId = (candidate) => {
      if (!candidate || typeof candidate !== "object") {
        return "";
      }

      const directIds = [
        candidate.id,
        candidate.node?.id,
        candidate.data?.id,
        candidate.node?.data?.id,
        candidate.item?.id,
        candidate.item?.data?.id,
      ];
      for (const candidateId of directIds) {
        const normalizedCandidateId = String(candidateId || "").trim();
        if (normalizedCandidateId) {
          return normalizedCandidateId;
        }
      }

      if (typeof candidate.getData === "function") {
        try {
          return String(candidate.getData()?.id || "").trim();
        } catch {
          return "";
        }
      }

      return "";
    };
    const matchesNodeId = (candidate) => getCandidateNodeId(candidate) === normalizedNodeId;
    const candidateCollections = [
      canvas?.nodes,
      canvas?.nodeMap,
      canvas?.selectionManager?.nodes,
    ].filter(Boolean);

    for (const collection of candidateCollections) {
      if (collection instanceof Map) {
        const directMatch = collection.get(normalizedNodeId);
        if (directMatch) {
          return directMatch;
        }

        for (const value of collection.values()) {
          if (matchesNodeId(value)) {
            return value;
          }
        }
        continue;
      }

      if (Array.isArray(collection)) {
        const directMatch = collection.find((value) => matchesNodeId(value));
        if (directMatch) {
          return directMatch;
        }
        continue;
      }

      if (typeof collection === "object") {
        const directMatch = collection[normalizedNodeId];
        if (matchesNodeId(directMatch)) {
          return directMatch;
        }

        for (const value of Object.values(collection)) {
          if (matchesNodeId(value)) {
            return value;
          }
        }
      }
    }

    return null;
  }

  selectCanvasNodeInView(view, nodeId, runtimeNode = null) {
    const normalizedNodeId = String(nodeId || "").trim();
    const canvas = view?.canvas;
    if (!normalizedNodeId || !canvas) {
      return false;
    }

    const deselectCalls = [
      [canvas, "deselectAll"],
      [canvas?.selectionManager, "deselectAll"],
      [canvas?.selectionManager, "clear"],
    ];
    deselectCalls.forEach(([owner, method]) => {
      if (typeof owner?.[method] !== "function") {
        return;
      }

      try {
        owner[method]();
      } catch {
        // Ignore Canvas API differences across Obsidian versions.
      }
    });

    if (runtimeNode) {
      const selectCalls = [
        [canvas, "select"],
        [canvas?.selectionManager, "select"],
      ];
      for (const [owner, method] of selectCalls) {
        if (typeof owner?.[method] !== "function") {
          continue;
        }

        try {
          owner[method](runtimeNode);
          return true;
        } catch {
          // Fall through to DOM selection fallback below.
        }
      }
    }

    const selector = `[data-node-id="${escapeAttributeSelectorValue(normalizedNodeId)}"]`;
    const nodeEl = view?.containerEl?.querySelector?.(selector);
    if (!nodeEl) {
      return false;
    }

    ["mousedown", "mouseup", "click"].forEach((eventName) => {
      try {
        nodeEl.dispatchEvent(new MouseEvent(eventName, {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
      } catch {
        // Ignore DOM event dispatch failures on older runtimes.
      }
    });
    return true;
  }

  focusCanvasNodeInView(view, canvasPath, nodeId) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeId = String(nodeId || "").trim();
    if (!view?.canvas || !normalizedCanvasPath || !normalizedNodeId) {
      return false;
    }

    const node = this.readCanvasNodeByIdSync(normalizedCanvasPath, normalizedNodeId);
    if (!node) {
      return false;
    }

    if (typeof view.canvas.zoomToBbox === "function") {
      try {
        view.canvas.zoomToBbox({
          minX: toFiniteNumber(node?.x, 0) - Math.max(1, toFiniteNumber(node?.width, RESULT_NODE_DEFAULT_WIDTH)),
          minY: toFiniteNumber(node?.y, 0) - Math.max(1, toFiniteNumber(node?.height, RESULT_NODE_MIN_HEIGHT)),
          maxX: toFiniteNumber(node?.x, 0) + Math.max(1, toFiniteNumber(node?.width, RESULT_NODE_DEFAULT_WIDTH)),
          maxY: toFiniteNumber(node?.y, 0) + Math.max(1, toFiniteNumber(node?.height, RESULT_NODE_MIN_HEIGHT)),
        });
      } catch {
        // Ignore zoom failures and still attempt selection below.
      }
    }

    const runtimeNode = this.findCanvasRuntimeNodeById(view.canvas, normalizedNodeId);
    return this.selectCanvasNodeInView(view, normalizedNodeId, runtimeNode);
  }

  async revealCanvasNode(canvasPath, nodeId) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedCanvasPath || !normalizedNodeId) {
      return false;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(normalizedCanvasPath);
    if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
      return false;
    }

    const activeLeaf = this.app.workspace.activeLeaf;
    const reusableLeaf = this.app.workspace.getMostRecentLeaf();
    const leaf = this.findCanvasLeafByPath(normalizedCanvasPath)
      || (activeLeaf?.view?.getViewType?.() === "canvas" ? activeLeaf : null)
      || this.app.workspace.getLeavesOfType("canvas")[0]
      || (reusableLeaf?.view?.getViewType?.() === VIEW_TYPE ? null : reusableLeaf)
      || this.app.workspace.getLeaf(true);
    await leaf.openFile(abstractFile);
    this.app.workspace.revealLeaf(leaf);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const view = leaf?.view?.getViewType?.() === "canvas"
        ? leaf.view
        : this.resolver.getActiveCanvasView();
      const viewCanvasPath = String(view?.file?.path || "").trim();
      if (viewCanvasPath === normalizedCanvasPath && this.focusCanvasNodeInView(view, normalizedCanvasPath, normalizedNodeId)) {
        return true;
      }

      await sleep(attempt === 0 ? 0 : 50);
    }

    return false;
  }

  async revealTaskInCanvas(task) {
    const ref = this.getTaskJumpNodeRef(task);
    if (!ref) {
      return false;
    }

    return this.revealCanvasNode(ref.canvasPath, ref.nodeId);
  }

  async activateTaskFromList(taskId, options = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    const task = this.tasksById[normalizedTaskId] || null;
    if (!task) {
      return false;
    }

    await this.setActiveTask(normalizedTaskId, {
      revealInActiveTab: options.revealInActiveTab !== false,
    });
    if (options.revealInCanvas === false) {
      return true;
    }

    return this.revealTaskInCanvas(this.tasksById[normalizedTaskId] || task);
  }

  async ensurePanelVisibleOnStartup() {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) {
      return;
    }

    try {
      await this.activateView();
    } catch {
      // Ignore startup panel errors and let the manual command remain the fallback.
    }
  }

  handleCanvasFileMutation(file) {
    if (!(file instanceof TFile) || file.extension !== "canvas") {
      return;
    }

    const canvasPath = String(file.path || "").trim();
    if (!canvasPath) {
      return;
    }

    const previousSnapshot = this.canvasSnapshotCacheByPath.get(canvasPath) || null;
    this.invalidateCanvasSnapshot(canvasPath);

    const activeCanvasPath = this.getActiveCanvasPath();
    const affectsKnownTask = Object.values(this.tasksById).some((task) => this.getTaskCanvasPath(task) === canvasPath);
    if (!affectsKnownTask && activeCanvasPath !== canvasPath) {
      return;
    }

    const nextSnapshot = this.getCanvasSnapshotSync(canvasPath);
    const autoRunNodeIds = this.getAutoRunCandidateNodeIds(previousSnapshot, nextSnapshot);
    if (autoRunNodeIds.length > 0) {
      void this.triggerAutoRunForCanvasNodes(canvasPath, autoRunNodeIds);
    }

    this.syncActiveTaskToCanvasContext();
    void this.refreshSelectedGroupContextPreview();
    this.scheduleCanvasNodeHighlightSync(canvasPath);
    this.requestViewRefresh();
  }

  hasFocusedComposer() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).some((leaf) => {
      return typeof leaf.view?.hasFocusedComposer === "function" && leaf.view.hasFocusedComposer();
    });
  }

  hasHoveredTaskList() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).some((leaf) => {
      return typeof leaf.view?.hasHoveredTaskList === "function" && leaf.view.hasHoveredTaskList();
    });
  }

  setComposerFocused(isFocused) {
    this.composerFocused = Boolean(isFocused);
    if (this.composerFocused) {
      window.clearTimeout(this.viewRefreshTimer);
      return;
    }

    if (!this.pendingViewRefresh) {
      return;
    }

    window.clearTimeout(this.viewRefreshTimer);
    this.viewRefreshTimer = window.setTimeout(() => {
      if (this.pendingViewRefresh && !this.hasFocusedComposer() && !this.hasHoveredTaskList()) {
        this.requestViewRefresh({ force: true });
      }
    }, 0);
  }

  setTaskListHovered(isHovered) {
    this.taskListHovered = Boolean(isHovered);
    if (this.taskListHovered) {
      window.clearTimeout(this.viewRefreshTimer);
      return;
    }

    if (!this.pendingViewRefresh) {
      return;
    }

    window.clearTimeout(this.viewRefreshTimer);
    this.viewRefreshTimer = window.setTimeout(() => {
      if (this.pendingViewRefresh && !this.hasFocusedComposer() && !this.hasHoveredTaskList()) {
        this.requestViewRefresh({ force: true });
      }
    }, 0);
  }

  requestViewRefresh(options = {}) {
    const force = options.force === true;
    if (!force && (this.composerFocused || this.hasFocusedComposer() || this.taskListHovered || this.hasHoveredTaskList())) {
      this.pendingViewRefresh = true;
      window.clearTimeout(this.viewRefreshTimer);
      return;
    }

    this.pendingViewRefresh = false;
    window.clearTimeout(this.viewRefreshTimer);
    this.viewRefreshTimer = window.setTimeout(() => {
      this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
        if (leaf.view?.render) {
          leaf.view.render();
        }
      });
    }, 50);
  }

  async refreshTasks() {
    try {
      const response = await this.api.getTasks();
      this.runtimeIssue = "";
      const previousTasksById = this.tasksById;
      const nextTasksById = {};

      for (const rawTask of response.tasks || []) {
        const taskId = String(rawTask?.taskId || "").trim();
        if (!taskId) {
          continue;
        }

        const nextTask = this.normalizeTaskForStore(rawTask, previousTasksById[taskId] || null);
        if (!nextTask) {
          continue;
        }

        nextTasksById[taskId] = nextTask;
      }

      this.tasksById = nextTasksById;
      this.syncActiveTaskToCanvasContext();
      Object.values(this.tasksById).forEach((task) => {
        const previousTask = previousTasksById[task.taskId] || null;
        this.maybeSyncCanvasNodeHighlights(task, previousTask);
        this.maybeSyncTaskResultNode(task, previousTask);
      });
      this.reconcileAllCanvasNodeHighlights();

      await this.persistPluginState();
      this.requestViewRefresh();
      const activeTask = this.getActiveTask();
      if (activeTask && !this.taskHasLoadedMessages(activeTask)) {
        void this.hydrateTaskDetails(activeTask.taskId, { force: true });
      }
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      this.requestViewRefresh();
    }
  }

  async refreshTask(taskId, options = {}) {
    if (!taskId) {
      return;
    }

    try {
      const response = await this.api.getTask(taskId);
      this.mergeTask(response.task);
      this.requestViewRefresh(options);
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      this.requestViewRefresh(options);
    }
  }

  async hydrateTaskDetails(taskId, options = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      return;
    }

    const task = this.tasksById[normalizedTaskId] || null;
    if (!task || this.taskHasLoadedMessages(task) || this.taskDetailRefreshInFlight.has(normalizedTaskId)) {
      return;
    }

    this.taskDetailRefreshInFlight.add(normalizedTaskId);
    try {
      await this.refreshTask(normalizedTaskId, options);
    } finally {
      this.taskDetailRefreshInFlight.delete(normalizedTaskId);
    }
  }

  disposeActiveStream() {
    if (typeof this.activeStreamDisposer === "function") {
      this.activeStreamDisposer();
    }
    this.activeStreamDisposer = null;
  }

  subscribeToTask(taskId) {
    this.disposeActiveStream();
    if (!taskId) {
      return;
    }

    try {
      this.activeStreamDisposer = this.api.openTaskStream(taskId, (_event, payload) => {
        if (payload?.task) {
          this.mergeTask(payload.task);
          this.requestViewRefresh();
        }
      });
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      this.requestViewRefresh();
    }
  }

  async setActiveTask(taskId, options = {}) {
    this.uiState.activeTaskId = taskId;
    if (options.revealInActiveTab) {
      this.uiState.panelTab = PANEL_TAB_OPTIONS.ACTIVE_TASK;
    }
    await this.persistPluginState();
    this.subscribeToTask(taskId);
    this.requestViewRefresh();
    void this.hydrateTaskDetails(taskId, { force: true });
  }

  async handleNewThreadFromSelectionCommand() {
    await this.runActiveSelection({ forceNewTask: true });
  }

  async runActiveSelection(options = {}) {
    const selection = await this.resolveSelectionForAction();
    return this.runResolvedSelection(selection, options);
  }

  async runResolvedSelection(selection, options = {}) {
    try {
      let effectiveSelection = selection;
      if (options.forceNewTask === true) {
        const followUpResult = await this.runSelectionAsFollowUp(selection);
        if (followUpResult) {
          await this.appendDebugEvent("follow_up_requested", {
            taskId: followUpResult.task.taskId,
            message: followUpResult.message,
            sourceNodeId: selection.nodeIds?.[0] || "",
          });
          this.runtimeIssue = "";
          await this.setActiveTask(followUpResult.task.taskId, { revealInActiveTab: true });
          new Notice("Sent this selection to the existing OpenAgent thread.");
          await this.refreshTask(followUpResult.task.taskId, { force: true });
          return;
        }

        effectiveSelection = await this.resolver.addImplicitCanvasMarkdownContext(selection);
      }

      this.rememberSelectionSnapshot(effectiveSelection);
      await this.appendDebugEvent("selection_resolved", {
        mode: options.forceNewTask === true ? "new-thread" : "selection",
        canvasPath: effectiveSelection.canvasPath,
        nodeIds: effectiveSelection.nodeIds,
        textCount: effectiveSelection.textBlocks?.length || 0,
        fileCount: effectiveSelection.markdownFiles?.length || 0,
      });
      const selectionSummary = this.summarizeSelection(effectiveSelection);
      const inferredCwd = this.resolveWorkspaceRepoPathForSelection(effectiveSelection) || this.resolver.inferWorkingDirectory(effectiveSelection);
      await this.appendDebugEvent("raw_prompt_prepared", {
        promptPreview: options.forceNewTask === true
          ? this.truncateInline(this.getNewThreadPromptFromSelection(effectiveSelection, { cwd: inferredCwd }), 180)
          : "",
        cwd: inferredCwd,
      });
      await this.activateView();

      const rawPrompt = this.getNewThreadPromptFromSelection(effectiveSelection, { cwd: inferredCwd });
      const response = await this.api.createTaskFromCanvasSelection({
        ...effectiveSelection,
        cwd: inferredCwd,
        forceNewTask: options.forceNewTask === true,
        runtimeConfig: this.buildRuntimeConfigPayload(),
      });
      const task = this.mergeTask(response.task);
      await this.appendDebugEvent("task_created", {
        taskId: task.taskId,
        threadId: task.threadId || "",
        cwd: task.cwd,
        selectionKey: task.selectionKey,
      });
      this.runtimeIssue = "";
      await this.setActiveTask(task.taskId, { revealInActiveTab: true });

      if (!task.cwd) {
        new Notice(
          selectionSummary
            ? `${selectionSummary}. Set a working directory in the OpenAgent panel to continue.`
            : "Set a working directory in the OpenAgent panel to continue."
        );
        return;
      }

      new Notice(
        options.forceNewTask === true
          ? "Starting a new OpenAgent thread."
          : "OpenAgent is ready for this selection."
      );

      await this.api.runTask(task.taskId, {
        rawPrompt,
        transcriptMessage: rawPrompt,
        forceContext: false,
        runtimeConfig: this.buildRuntimeConfigPayload(),
      });
      await this.appendDebugEvent("run_requested", {
        taskId: task.taskId,
        rawPrompt,
      });
      await this.refreshTask(task.taskId);
      const refreshedTask = this.tasksById[task.taskId] || task;
      await this.appendDebugEvent("task_refreshed", {
        taskId: refreshedTask.taskId,
        threadId: refreshedTask.threadId || "",
        status: refreshedTask.status || "",
        lastMessage: Array.isArray(refreshedTask.messages) && refreshedTask.messages.length > 0
          ? String(refreshedTask.messages[refreshedTask.messages.length - 1]?.text || "")
          : "",
      });
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      await this.appendDebugEvent("new_thread_error", {
        message: this.runtimeIssue,
      });
      new Notice(this.runtimeIssue);
      this.requestViewRefresh();
    }
  }

  async resolveSelectionForAction() {
    try {
      const selection = await this.resolver.resolveActiveSelection();
      this.rememberSelectionSnapshot(selection);
      return selection;
    } catch (error) {
      if (!this.isMissingSelectionError(error)) {
        throw error;
      }

      const fallbackSelection = await this.resolveRecentSelectionSnapshot();
      this.rememberSelectionSnapshot(fallbackSelection);
      new Notice("Using the most recent Canvas selection.");
      return fallbackSelection;
    }
  }

  isMissingSelectionError(error) {
    const message = String(error?.message || error || "");
    return message.includes("Select one or more Canvas nodes first.");
  }

  captureCanvasSelectionSnapshot() {
    try {
      const view = this.resolver.getActiveCanvasView();
      if (!view) {
        return;
      }

      const file = view.file || this.app.workspace.getActiveFile();
      if (!(file instanceof TFile) || file.extension !== "canvas") {
        return;
      }

      const nodeIds = this.resolver.extractSelectedNodeIds(view);
      const previousSnapshot = this.lastCanvasSelectionSnapshot;
      if (nodeIds.length === 0) {
        const didClearSelection = (
          previousSnapshot?.canvasPath === file.path
          && Array.isArray(previousSnapshot?.nodeIds)
          && previousSnapshot.nodeIds.length > 0
        );
        this.lastCanvasSelectionSnapshot = {
          canvasPath: file.path,
          nodeIds: [],
          selectionIdentity: "",
          capturedAt: Date.now(),
          selectedNodeType: "",
          selectedNodeLabel: "",
        };
        if (didClearSelection) {
          this.syncActiveTaskToCanvasContext();
          void this.refreshSelectedGroupContextPreview({ force: true });
          this.requestViewRefresh();
        }
        return;
      }

      const liveNodeDataById = this.resolver.extractLiveSelectedNodeDataById(view, nodeIds);
      const selectedNode = nodeIds.length === 1 ? liveNodeDataById.get(String(nodeIds[0] || "")) || null : null;
      const nextSnapshot = {
        canvasPath: file.path,
        nodeIds: Array.from(new Set(nodeIds.map((nodeId) => String(nodeId)).filter(Boolean))).sort(),
        selectionIdentity: this.buildTaskSelectionIdentityFromNodeIds(file.path, nodeIds),
        capturedAt: Date.now(),
        selectedNodeType: String(selectedNode?.type || "").trim(),
        selectedNodeLabel: String(selectedNode?.label || "").trim(),
      };
      const selectionUnchanged = (
        previousSnapshot?.canvasPath === nextSnapshot.canvasPath
        && previousSnapshot?.selectionIdentity === nextSnapshot.selectionIdentity
        && Array.isArray(previousSnapshot?.nodeIds)
        && previousSnapshot.nodeIds.length === nextSnapshot.nodeIds.length
        && previousSnapshot.nodeIds.every((nodeId, index) => nodeId === nextSnapshot.nodeIds[index])
        && String(previousSnapshot?.selectedNodeType || "") === nextSnapshot.selectedNodeType
        && String(previousSnapshot?.selectedNodeLabel || "") === nextSnapshot.selectedNodeLabel
      );
      this.lastCanvasSelectionSnapshot = nextSnapshot;
      if (!selectionUnchanged) {
        this.syncActiveTaskToCanvasContext();
        void this.refreshSelectedGroupContextPreview({ snapshot: nextSnapshot, force: true });
        this.requestViewRefresh();
      }
    } catch {
      // Ignore transient Canvas introspection failures during polling.
    }
  }

  async resolveRecentSelectionSnapshot() {
    const snapshot = this.lastCanvasSelectionSnapshot;
    if (!snapshot?.canvasPath || !Array.isArray(snapshot.nodeIds) || snapshot.nodeIds.length === 0) {
      throw new Error("Select one or more Canvas nodes first.");
    }

    if (Date.now() - Number(snapshot.capturedAt || 0) > RECENT_SELECTION_TTL_MS) {
      throw new Error("Select one or more Canvas nodes first.");
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(snapshot.canvasPath);
    if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
      throw new Error("The recent Canvas selection is no longer available.");
    }

    return this.resolver.resolveCanvasSelection(abstractFile, snapshot.nodeIds);
  }

  rememberSelectionSnapshot(selection) {
    const canvasPath = String(selection?.canvasPath || "").trim();
    const nodeIds = Array.isArray(selection?.nodeIds) ? selection.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean) : [];
    if (!canvasPath || nodeIds.length === 0) {
      return;
    }

    this.lastCanvasSelectionSnapshot = {
      canvasPath,
      nodeIds: Array.from(new Set(nodeIds)).sort(),
      selectionIdentity: this.buildTaskSelectionIdentityFromNodeIds(canvasPath, nodeIds),
      capturedAt: Date.now(),
      selectedNodeType: "",
      selectedNodeLabel: "",
    };
    this.syncActiveTaskToCanvasContext();
    void this.refreshSelectedGroupContextPreview({ force: true });
  }

  getRecentSelectionSnapshotForActiveCanvas() {
    const snapshot = this.lastCanvasSelectionSnapshot;
    const activeCanvasPath = this.getActiveCanvasPath();
    if (!snapshot?.canvasPath || !activeCanvasPath || snapshot.canvasPath !== activeCanvasPath) {
      return null;
    }

    const nodeIds = Array.isArray(snapshot.nodeIds)
      ? snapshot.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean)
      : [];
    if (nodeIds.length === 0) {
      return null;
    }

    if (Date.now() - Number(snapshot.capturedAt || 0) > RECENT_SELECTION_TTL_MS) {
      return null;
    }

    return {
      ...snapshot,
      nodeIds,
    };
  }

  buildSelectedGroupContextPreviewKey(snapshot = null) {
    const targetSnapshot = snapshot || this.getRecentSelectionSnapshotForActiveCanvas();
    if (!targetSnapshot?.canvasPath || !Array.isArray(targetSnapshot.nodeIds) || targetSnapshot.nodeIds.length !== 1) {
      return "";
    }

    if (String(targetSnapshot.selectedNodeType || "").trim() !== "group") {
      return "";
    }

    return `${targetSnapshot.canvasPath}::${targetSnapshot.nodeIds[0]}`;
  }

  buildLoadingSelectedGroupContextPreview(snapshot) {
    if (!snapshot?.canvasPath) {
      return null;
    }

    return {
      status: "loading",
      canvasPath: snapshot.canvasPath,
      groupNodeId: Array.isArray(snapshot.nodeIds) ? String(snapshot.nodeIds[0] || "").trim() : "",
      groupLabel: String(snapshot.selectedNodeLabel || "").trim() || "Untitled group",
      textBlocks: [],
      markdownFiles: [],
      warnings: [],
    };
  }

  async readCanvasMarkdownFilePreviewEntry(node, warnings = []) {
    const filePath = typeof node?.file === "string" ? node.file.trim() : "";
    const abstractFile = await this.resolver.waitForMarkdownCanvasFile(filePath, { timeoutMs: 0 });
    if (!(abstractFile instanceof TFile)) {
      warnings.push(`Missing file node target: ${filePath}`);
      return null;
    }

    if (abstractFile.extension !== "md") {
      warnings.push(`Unsupported file node type skipped: ${filePath}`);
      return null;
    }

    const vaultBasePath = this.getVaultBasePath();
    return {
      id: String(node?.id || ""),
      path: abstractFile.path,
      absolutePath: vaultBasePath
        ? this.resolver.resolveVaultPath(vaultBasePath, abstractFile.path)
        : "",
      name: abstractFile.basename,
    };
  }

  async buildSelectedGroupContextPreview(snapshot) {
    const canvasPath = String(snapshot?.canvasPath || "").trim();
    const groupNodeId = Array.isArray(snapshot?.nodeIds) ? String(snapshot.nodeIds[0] || "").trim() : "";
    if (!canvasPath || !groupNodeId) {
      return null;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(canvasPath);
    if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(await this.app.vault.cachedRead(abstractFile));
    } catch {
      return null;
    }

    const nodeById = new Map(
      (Array.isArray(parsed?.nodes) ? parsed.nodes : []).map((node) => [String(node?.id || "").trim(), node])
    );
    const selectedNode = nodeById.get(groupNodeId) || null;
    if (String(selectedNode?.type || "") !== "group") {
      return null;
    }

    const containedNodes = Array.from(nodeById.values())
      .filter((node) => {
        const nodeId = String(node?.id || "").trim();
        return nodeId && nodeId !== groupNodeId && this.resolver.doesCanvasGroupContainNode(selectedNode, node);
      })
      .sort(compareCanvasNodeOrder);

    const textBlocks = [];
    const markdownFiles = [];
    const warnings = [];
    const previewEntries = await Promise.all(containedNodes.map(async (node) => {
      const nodeId = String(node?.id || "").trim();
      if (!nodeId) {
        return null;
      }

      if (String(node?.type || "") === "text") {
        const text = typeof node?.text === "string" ? node.text.trim() : "";
        return text ? { kind: "text", value: { id: nodeId, text } } : null;
      }

      if (String(node?.type || "") === "file") {
        const nodeWarnings = [];
        const markdownFile = await this.readCanvasMarkdownFilePreviewEntry(node, nodeWarnings);
        return {
          kind: "file",
          value: markdownFile,
          warnings: nodeWarnings,
        };
      }

      return null;
    }));

    previewEntries.forEach((entry) => {
      if (!entry) {
        return;
      }

      if (entry.kind === "text" && entry.value) {
        textBlocks.push(entry.value);
      }

      if (entry.kind === "file" && entry.value) {
        markdownFiles.push(entry.value);
      }

      if (Array.isArray(entry.warnings) && entry.warnings.length > 0) {
        warnings.push(...entry.warnings);
      }
    });

    return {
      status: "ready",
      canvasPath,
      groupNodeId,
      groupLabel: String(selectedNode?.label || "").trim() || String(snapshot?.selectedNodeLabel || "").trim() || "Untitled group",
      textBlocks,
      markdownFiles,
      warnings,
    };
  }

  async refreshSelectedGroupContextPreview(options = {}) {
    const snapshot = options.snapshot || this.getRecentSelectionSnapshotForActiveCanvas();
    const nextKey = this.buildSelectedGroupContextPreviewKey(snapshot);
    if (!nextKey) {
      const didChange = this.selectedGroupContextPreviewState.key || this.selectedGroupContextPreviewState.preview || this.selectedGroupContextPreviewState.loading;
      this.selectedGroupContextPreviewState = {
        key: "",
        preview: null,
        loading: false,
      };
      if (didChange) {
        this.requestViewRefresh();
      }
      return null;
    }

    if (
      options.force !== true
      && this.selectedGroupContextPreviewState.key === nextKey
      && (this.selectedGroupContextPreviewState.loading || this.selectedGroupContextPreviewState.preview)
    ) {
      return this.selectedGroupContextPreviewState.preview;
    }

    this.selectedGroupContextPreviewState = {
      key: nextKey,
      preview: this.buildLoadingSelectedGroupContextPreview(snapshot),
      loading: true,
    };
    this.requestViewRefresh();

    const loadPromise = this.buildSelectedGroupContextPreview(snapshot)
      .then((preview) => {
        if (this.selectedGroupContextPreviewState.key !== nextKey) {
          return preview;
        }

        this.selectedGroupContextPreviewState = {
          key: nextKey,
          preview,
          loading: false,
        };
        this.requestViewRefresh();
        return preview;
      })
      .catch(() => {
        if (this.selectedGroupContextPreviewState.key === nextKey) {
          this.selectedGroupContextPreviewState = {
            key: nextKey,
            preview: null,
            loading: false,
          };
          this.requestViewRefresh();
        }
        return null;
      })
      .finally(() => {
        if (this.selectedGroupContextPreviewLoadPromise === loadPromise) {
          this.selectedGroupContextPreviewLoadPromise = null;
        }
      });

    this.selectedGroupContextPreviewLoadPromise = loadPromise;
    return loadPromise;
  }

  handleSelectedGroupContextDependencyMutation(file, oldPath = "") {
    const snapshot = this.getRecentSelectionSnapshotForActiveCanvas();
    const previewKey = this.buildSelectedGroupContextPreviewKey(snapshot);
    if (!previewKey) {
      return;
    }

    const nextPath = file instanceof TFile ? String(file.path || "").trim() : "";
    const normalizedOldPath = String(oldPath || "").trim();
    const preview = this.selectedGroupContextPreviewState.preview;
    const dependsOnCurrentFile = [nextPath, normalizedOldPath].some((candidatePath) => {
      if (!candidatePath) {
        return false;
      }

      if (candidatePath === snapshot.canvasPath) {
        return true;
      }

      return Array.isArray(preview?.markdownFiles) && preview.markdownFiles.some((markdownFile) => markdownFile?.path === candidatePath);
    });
    if (!dependsOnCurrentFile) {
      return;
    }

    void this.refreshSelectedGroupContextPreview({ snapshot, force: true });
  }

  getSelectedGroupContextPreview() {
    const snapshot = this.getRecentSelectionSnapshotForActiveCanvas();
    const previewKey = this.buildSelectedGroupContextPreviewKey(snapshot);
    if (!previewKey) {
      return null;
    }

    if (this.selectedGroupContextPreviewState.key !== previewKey) {
      void this.refreshSelectedGroupContextPreview({ snapshot });
      return this.buildLoadingSelectedGroupContextPreview(snapshot);
    }

    return this.selectedGroupContextPreviewState.preview || this.buildLoadingSelectedGroupContextPreview(snapshot);
  }

  getActiveCanvasPath() {
    const view = this.resolver.getActiveCanvasView();
    const file = view?.file || this.app.workspace.getActiveFile();
    return file instanceof TFile && file.extension === "canvas" ? file.path : "";
  }

  getCanvasAbsolutePath(canvasPath) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const vaultBasePath = this.getVaultBasePath();
    if (!normalizedCanvasPath || !vaultBasePath) {
      return "";
    }

    return path.join(vaultBasePath, ...normalizedCanvasPath.split("/"));
  }

  async autoArrangeActiveCanvas() {
    try {
      const view = this.resolver.getActiveCanvasView();
      if (!view) {
        throw new Error("Open a Canvas view first.");
      }

      const file = view.file || this.app.workspace.getActiveFile();
      if (!(file instanceof TFile) || file.extension !== "canvas") {
        throw new Error("The active view is not backed by a .canvas file.");
      }

      await this.resolver.flushPendingCanvasEdits(view);
      const result = await this.withSerializedCanvasMutation(file.path, async () => {
        const raw = await this.app.vault.cachedRead(file);
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error(`Unable to parse canvas JSON for ${file.path}`);
        }

        const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
        const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
        if (nodes.length === 0) {
          throw new Error("This Canvas has no nodes to arrange.");
        }

        const arrangedNodes = autoArrangeCanvasNodes(nodes, edges);
        const changed = arrangedNodes.some((node, index) => {
          const previousNode = nodes[index] || {};
          return (
            toFiniteNumber(node?.x, 0) !== toFiniteNumber(previousNode?.x, 0)
            || toFiniteNumber(node?.y, 0) !== toFiniteNumber(previousNode?.y, 0)
          );
        });
        if (!changed) {
          return { changed: false, parsed };
        }

        const nextParsed = {
          ...parsed,
          nodes: arrangedNodes,
          edges,
        };
        await this.app.vault.modify(file, JSON.stringify(nextParsed, null, 2) + "\n");
        this.primeCanvasSnapshot(file.path, nextParsed);
        return {
          changed: true,
          parsed: nextParsed,
          nodeCount: arrangedNodes.length,
        };
      });

      this.runtimeIssue = "";
      this.scheduleCanvasNodeHighlightSync(file.path);
      this.requestViewRefresh({ force: true });
      await this.appendDebugEvent("canvas_auto_arranged", {
        canvasPath: file.path,
        changed: result.changed,
        nodeCount: result.nodeCount || 0,
      });
      new Notice(result.changed
        ? "Arranged Canvas nodes without changing edges."
        : "Canvas nodes are already arranged.");
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      await this.appendDebugEvent("canvas_auto_arrange_error", {
        message: this.runtimeIssue,
      });
      new Notice(this.runtimeIssue);
      this.requestViewRefresh({ force: true });
    }
  }

  buildCanvasSnapshot(parsed) {
    const safeParsed = parsed && typeof parsed === "object" ? parsed : {};
    const nodes = Array.isArray(safeParsed.nodes) ? safeParsed.nodes : [];
    const edges = Array.isArray(safeParsed.edges) ? safeParsed.edges : [];
    const nodeIds = new Set();
    const nodeById = new Map();
    const incomingEdgesByNodeId = new Map();
    const resultSourceNodeIdByResultNodeId = new Map();

    nodes.forEach((node) => {
      const nodeId = String(node?.id || "").trim();
      if (!nodeId) {
        return;
      }

      nodeIds.add(nodeId);
      nodeById.set(nodeId, node);

      const sourceNodeId = getOpenAgentResultSourceNodeId(node);
      if (sourceNodeId) {
        resultSourceNodeIdByResultNodeId.set(nodeId, sourceNodeId);
      }
    });

    edges.forEach((edge) => {
      const fromNodeId = String(edge?.fromNode || "").trim();
      const toNodeId = String(edge?.toNode || "").trim();
      if (!fromNodeId || !toNodeId) {
        return;
      }

      const incomingEdges = incomingEdgesByNodeId.get(toNodeId) || [];
      incomingEdges.push(edge);
      incomingEdgesByNodeId.set(toNodeId, incomingEdges);

      if (toNodeId.startsWith("oa-result-") && !resultSourceNodeIdByResultNodeId.has(toNodeId)) {
        resultSourceNodeIdByResultNodeId.set(toNodeId, fromNodeId);
      }
    });

    return {
      parsed: safeParsed,
      nodeIds,
      nodeById,
      incomingEdgesByNodeId,
      resultSourceNodeIdByResultNodeId,
    };
  }

  primeCanvasSnapshot(canvasPath, parsed) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    if (!normalizedCanvasPath) {
      return null;
    }

    const snapshot = this.buildCanvasSnapshot(parsed);
    this.canvasSnapshotCacheByPath.set(normalizedCanvasPath, snapshot);
    return snapshot;
  }

  invalidateCanvasSnapshot(canvasPath) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    if (!normalizedCanvasPath) {
      return;
    }

    this.canvasSnapshotCacheByPath.delete(normalizedCanvasPath);
  }

  getCanvasSnapshotSync(canvasPath) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    if (!normalizedCanvasPath) {
      return null;
    }

    if (this.canvasSnapshotCacheByPath.has(normalizedCanvasPath)) {
      return this.canvasSnapshotCacheByPath.get(normalizedCanvasPath);
    }

    const absoluteCanvasPath = this.getCanvasAbsolutePath(normalizedCanvasPath);
    if (!absoluteCanvasPath || !fs.existsSync(absoluteCanvasPath)) {
      this.canvasSnapshotCacheByPath.set(normalizedCanvasPath, null);
      return null;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(absoluteCanvasPath, "utf8"));
      return this.primeCanvasSnapshot(normalizedCanvasPath, parsed);
    } catch {
      this.canvasSnapshotCacheByPath.set(normalizedCanvasPath, null);
      return null;
    }
  }

  normalizeCanvasNodeColorValue(value) {
    return String(value || "").trim().toLowerCase();
  }

  isAutoRunTriggerCanvasNodeColor(value) {
    const normalizedValue = this.normalizeCanvasNodeColorValue(value);
    return normalizedValue !== "" && AUTO_RUN_TRIGGER_CANVAS_NODE_COLORS.includes(normalizedValue);
  }

  isAutoRunnableCanvasNode(node) {
    if (!node || typeof node !== "object" || isOpenAgentAssistantResultNode(node)) {
      return false;
    }

    const nodeType = String(node?.type || "").trim();
    return nodeType === "text" || nodeType === "file";
  }

  getAutoRunCandidateNodeIds(previousSnapshot, nextSnapshot) {
    if (!nextSnapshot?.nodeById) {
      return [];
    }

    const nodeIds = Array.from(nextSnapshot.nodeById.keys()).filter((nodeId) => {
      const nextNode = nextSnapshot.nodeById.get(nodeId);
      if (!this.isAutoRunnableCanvasNode(nextNode)) {
        return false;
      }

      const nextColor = this.normalizeCanvasNodeColorValue(nextNode?.color);
      if (!this.isAutoRunTriggerCanvasNodeColor(nextColor)) {
        return false;
      }

      const previousColor = this.normalizeCanvasNodeColorValue(previousSnapshot?.nodeById?.get(nodeId)?.color);
      return !this.isAutoRunTriggerCanvasNodeColor(previousColor);
    });

    return nodeIds.sort((leftNodeId, rightNodeId) => {
      return compareCanvasNodeOrder(
        nextSnapshot.nodeById.get(leftNodeId),
        nextSnapshot.nodeById.get(rightNodeId)
      );
    });
  }

  async triggerAutoRunForCanvasNodes(canvasPath, nodeIds) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeIds = Array.from(new Set(
      (Array.isArray(nodeIds) ? nodeIds : [])
        .map((nodeId) => String(nodeId || "").trim())
        .filter(Boolean)
    ));
    if (!normalizedCanvasPath || normalizedNodeIds.length === 0) {
      return;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(normalizedCanvasPath);
    if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
      return;
    }

    for (const nodeId of normalizedNodeIds) {
      const autoRunKey = this.getCanvasNodeHighlightKey(normalizedCanvasPath, nodeId);
      if (!autoRunKey || this.canvasAutoRunInFlightByKey.has(autoRunKey)) {
        continue;
      }

      const existingTask = this.findTaskByCanvasRunSourceNode(normalizedCanvasPath, nodeId)
        || this.findTaskByRootCanvasNode(normalizedCanvasPath, nodeId);
      if (existingTask && this.isTaskRunning(existingTask)) {
        continue;
      }

      this.canvasAutoRunInFlightByKey.add(autoRunKey);
      try {
        const selection = await this.resolver.resolveCanvasSelection(abstractFile, [nodeId]);
        await this.appendDebugEvent("canvas_auto_run_triggered", {
          canvasPath: normalizedCanvasPath,
          nodeId,
          title: selection.title,
        });
        this.rememberSelectionSnapshot(selection);
        await this.runResolvedSelection(selection, { forceNewTask: true });
      } catch (error) {
        const message = String(error?.message || error);
        await this.appendDebugEvent("canvas_auto_run_error", {
          canvasPath: normalizedCanvasPath,
          nodeId,
          message,
        });
        new Notice(`Auto-run failed for Canvas node ${nodeId}: ${message}`);
      } finally {
        this.canvasAutoRunInFlightByKey.delete(autoRunKey);
      }
    }
  }

  async withSerializedCanvasMutation(canvasPath, operation) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    if (!normalizedCanvasPath) {
      return operation();
    }

    const previous = this.canvasMutationQueueByPath.get(normalizedCanvasPath) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => operation());
    this.canvasMutationQueueByPath.set(normalizedCanvasPath, next);

    try {
      return await next;
    } finally {
      if (this.canvasMutationQueueByPath.get(normalizedCanvasPath) === next) {
        this.canvasMutationQueueByPath.delete(normalizedCanvasPath);
      }
    }
  }

  getConversationSelectionNodeIds(canvasPath, nodeIds) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeIds = Array.from(new Set(
      (Array.isArray(nodeIds) ? nodeIds : [])
        .map((nodeId) => String(nodeId || "").trim())
        .filter(Boolean)
    )).sort();
    if (!normalizedCanvasPath || normalizedNodeIds.length === 0) {
      return [];
    }

    if (!normalizedNodeIds.some((nodeId) => nodeId.startsWith("oa-result-"))) {
      return normalizedNodeIds;
    }

    const snapshot = this.getCanvasSnapshotSync(normalizedCanvasPath);
    if (!snapshot) {
      return normalizedNodeIds;
    }

    return Array.from(new Set(
      normalizedNodeIds.map((nodeId) => snapshot.resultSourceNodeIdByResultNodeId.get(nodeId) || nodeId)
    )).sort();
  }

  buildTaskSelectionIdentityFromNodeIds(canvasPath, nodeIds) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const canonicalNodeIds = this.getConversationSelectionNodeIds(normalizedCanvasPath, nodeIds);
    if (!normalizedCanvasPath || canonicalNodeIds.length === 0) {
      return "";
    }

    return `${normalizedCanvasPath}\n${canonicalNodeIds.join("\n")}`;
  }

  getTaskCanvasPath(task) {
    return String(task?.canvasBinding?.canvasPath || task?.selectionContext?.canvasPath || task?.sourceRef || "").trim();
  }

  getTaskSelectionIdentity(task) {
    const canvasPath = this.getTaskCanvasPath(task);
    const nodeIds = Array.isArray(task?.selectionContext?.nodeIds)
      ? task.selectionContext.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean).sort()
      : [];
    return this.buildTaskSelectionIdentityFromNodeIds(canvasPath, nodeIds);
  }

  getRecentSelectionIdentityForCanvas(canvasPath) {
    const snapshot = this.lastCanvasSelectionSnapshot;
    if (!canvasPath || !snapshot || snapshot.canvasPath !== canvasPath) {
      return "";
    }

    if (Date.now() - Number(snapshot.capturedAt || 0) > RECENT_SELECTION_TTL_MS) {
      return "";
    }

    const nodeIds = Array.isArray(snapshot.nodeIds)
      ? snapshot.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean).sort()
      : [];
    if (nodeIds.length === 0) {
      return "";
    }

    return snapshot.selectionIdentity || this.buildTaskSelectionIdentityFromNodeIds(canvasPath, nodeIds);
  }

  resolveFollowUpTaskForCanvasNodeIds(canvasPath, nodeIds) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const normalizedNodeIds = Array.from(new Set(
      (Array.isArray(nodeIds) ? nodeIds : [])
        .map((nodeId) => String(nodeId || "").trim())
        .filter(Boolean)
    )).sort();
    if (!normalizedCanvasPath || normalizedNodeIds.length !== 1) {
      return null;
    }

    const selectedNodeId = normalizedNodeIds[0];
    if (!selectedNodeId || selectedNodeId.startsWith("oa-result-")) {
      return null;
    }

    const snapshot = this.getCanvasSnapshotSync(normalizedCanvasPath);
    if (!snapshot) {
      return null;
    }

    const selectedNode = snapshot.nodeById.get(selectedNodeId);
    if (!selectedNode || String(selectedNode?.type || "").trim() !== "text") {
      return null;
    }

    for (const edge of snapshot.incomingEdgesByNodeId.get(selectedNodeId) || []) {
      const upstreamNodeId = String(edge?.fromNode || "").trim();
      const task = this.findConversationTaskForUpstreamNode(normalizedCanvasPath, upstreamNodeId);
      if (task) {
        return task;
      }
    }

    return null;
  }

  getRecentSelectionTaskForCanvas(canvasPath) {
    const snapshot = this.lastCanvasSelectionSnapshot;
    if (!canvasPath || !snapshot || snapshot.canvasPath !== canvasPath) {
      return null;
    }

    if (Date.now() - Number(snapshot.capturedAt || 0) > RECENT_SELECTION_TTL_MS) {
      return null;
    }

    return this.resolveFollowUpTaskForCanvasNodeIds(canvasPath, snapshot.nodeIds);
  }

  hasExplicitCanvasDeselection(canvasPath) {
    const normalizedCanvasPath = String(canvasPath || "").trim();
    const snapshot = this.lastCanvasSelectionSnapshot;
    if (!normalizedCanvasPath || !snapshot || snapshot.canvasPath !== normalizedCanvasPath) {
      return false;
    }

    if (Date.now() - Number(snapshot.capturedAt || 0) > RECENT_SELECTION_TTL_MS) {
      return false;
    }

    const nodeIds = Array.isArray(snapshot.nodeIds)
      ? snapshot.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean)
      : [];
    return nodeIds.length === 0;
  }

  syncActiveTaskToCanvasContext() {
    const activeCanvasPath = this.getActiveCanvasPath();
    if (!activeCanvasPath) {
      return;
    }

    const archiveProbeCache = new Map();
    const visibleTasks = this.getVisibleTasks({ archiveProbeCache });
    const archivedTasks = this.getArchivedTasks({ archiveProbeCache });
    const selectedIdentity = this.getRecentSelectionIdentityForCanvas(activeCanvasPath);
    const currentTask = this.tasksById[this.uiState.activeTaskId] || null;
    let nextTask = null;

    if (selectedIdentity) {
      nextTask = visibleTasks.find((task) => this.getTaskSelectionIdentity(task) === selectedIdentity)
        || archivedTasks.find((task) => this.getTaskSelectionIdentity(task) === selectedIdentity)
        || null;

      if (!nextTask) {
        nextTask = this.getRecentSelectionTaskForCanvas(activeCanvasPath);
      }
    } else if (this.hasExplicitCanvasDeselection(activeCanvasPath)) {
      nextTask = null;
    } else {
      if (currentTask && this.getTaskCanvasPath(currentTask) === activeCanvasPath) {
        nextTask = currentTask;
      }

      if (!nextTask && visibleTasks.length > 0) {
        nextTask = visibleTasks[0];
      }

      if (!nextTask && archivedTasks.length > 0) {
        nextTask = archivedTasks[0];
      }
    }

    const nextTaskId = nextTask?.taskId || null;
    if (nextTaskId === this.uiState.activeTaskId) {
      return;
    }

    this.uiState.activeTaskId = nextTaskId;
    this.persistPluginState();
    if (nextTaskId) {
      this.subscribeToTask(nextTaskId);
      void this.hydrateTaskDetails(nextTaskId, { force: true });
    } else {
      this.disposeActiveStream();
    }
    this.requestViewRefresh();
  }

  async saveCwdForTask(taskId, cwd) {
    const task = this.tasksById[taskId];
    if (!task?.selectionContext) {
      new Notice("This task does not have enough selection context to change its project folder.");
      return;
    }

    const normalizedCwd = this.normalizeWorkingDirectoryInput(cwd);
    if (!normalizedCwd) {
      new Notice("Enter an absolute project folder path.");
      return;
    }

    try {
      const response = await this.api.createTaskFromCanvasSelection({
        ...task.selectionContext,
        title: task.title,
        cwd: normalizedCwd,
        runtimeConfig: this.buildRuntimeConfigPayload(),
      });
      const nextTask = this.mergeTask(response.task);
      await this.setActiveTask(nextTask.taskId, { revealInActiveTab: true });
      this.runtimeIssue = "";
      new Notice(`Project folder set to ${nextTask.cwd || "(not set)"}`);
      await this.refreshTask(nextTask.taskId);
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      new Notice(this.runtimeIssue);
      this.requestViewRefresh();
    }
  }

  async sendDraftForTask(taskId, options = {}) {
    const task = this.tasksById[taskId];
    if (task?.status === "running") {
      new Notice("Wait for the current turn to finish before sending another message.");
      return;
    }

    const draftSource = Object.prototype.hasOwnProperty.call(options, "draft")
      ? String(options.draft || "")
      : this.getDraft(taskId);
    if (Object.prototype.hasOwnProperty.call(options, "draft")) {
      this.setDraft(taskId, draftSource);
    }

    const draft = draftSource.trim();
    if (!draft) {
      new Notice("Write a follow-up message first.");
      return;
    }

    try {
      await this.api.sendMessage(taskId, draft, this.buildRuntimeConfigPayload());
      this.clearDraft(taskId);
      await this.refreshTask(taskId, { force: true });
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      new Notice(this.runtimeIssue);
      this.requestViewRefresh();
    }
  }

  async resumeLastTask() {
    await this.activateView();
    await this.refreshTasks();
    const task = this.getActiveTask() || this.getTasks()[0];
    if (!task) {
      new Notice("No OpenAgent task yet.");
      return;
    }

    await this.activateTaskFromList(task.taskId);
  }

  async stopActiveTask() {
    const task = this.getActiveTask();
    if (!task?.currentTurnId) {
      new Notice("No active turn to stop.");
      return;
    }

    try {
      await this.api.interruptTask(task.taskId);
      await this.refreshTask(task.taskId);
    } catch (error) {
      this.runtimeIssue = String(error?.message || error);
      new Notice(this.runtimeIssue);
      this.requestViewRefresh();
    }
  }

  normalizeWorkingDirectoryInput(cwd) {
    const trimmedCwd = String(cwd || "").trim();
    if (!trimmedCwd || !path.isAbsolute(trimmedCwd)) {
      return "";
    }

    return path.normalize(trimmedCwd);
  }

  summarizeSelection(selection) {
    const textCount = Array.isArray(selection?.textBlocks) ? selection.textBlocks.length : 0;
    const fileCount = Array.isArray(selection?.markdownFiles) ? selection.markdownFiles.length : 0;
    const parts = [];

    if (textCount > 0) {
      parts.push(`${textCount} text node${textCount === 1 ? "" : "s"}`);
    }

    if (fileCount > 0) {
      parts.push(`${fileCount} markdown file${fileCount === 1 ? "" : "s"}`);
    }

    const firstText = selection?.textBlocks?.[0]?.text;
    if (parts.length === 1 && textCount === 1 && typeof firstText === "string" && firstText.trim()) {
      return `Captured ${parts[0]}: ${this.truncateInline(firstText.trim(), 80)}`;
    }

    if (parts.length > 0) {
      return `Captured ${parts.join(" and ")}`;
    }

    return "";
  }

  getSelectionPreviewLines(selection) {
    const lines = [this.describeSelectionDebug(selection)];

    (selection?.textBlocks || []).forEach((block, index) => {
      const text = String(block?.text || "").trim();
      if (!text) {
        return;
      }

      lines.push(`Text node ${index + 1}: ${this.truncateInline(text, 240)}`);
    });

    (selection?.markdownFiles || []).forEach((file, index) => {
      const filePath = String(file?.path || "").trim();
      const preview = this.truncateInline(String(file?.content || "").trim(), 180);
      const label = `Markdown file ${index + 1}: ${filePath || file?.name || "Untitled"}`;
      lines.push(label);
      if (preview) {
        lines.push(preview);
      }
    });

    return lines;
  }

  describeSelectionDebug(selection) {
    const nodeIds = Array.isArray(selection?.nodeIds) ? selection.nodeIds.filter(Boolean) : [];
    const textCount = Array.isArray(selection?.textBlocks) ? selection.textBlocks.length : 0;
    const fileCount = Array.isArray(selection?.markdownFiles) ? selection.markdownFiles.length : 0;
    const warningCount = Array.isArray(selection?.warnings) ? selection.warnings.length : 0;
    const idsPreview = nodeIds.length > 0 ? nodeIds.join(", ") : "(none)";
    return `Selection debug: ids=${idsPreview} | text=${textCount} | files=${fileCount} | warnings=${warningCount}`;
  }

  getNewThreadPromptFromSelection(selection, options = {}) {
    const textBlocks = Array.isArray(selection?.textBlocks) ? selection.textBlocks : [];
    const markdownFiles = Array.isArray(selection?.markdownFiles) ? selection.markdownFiles : [];
    if (textBlocks.length === 0 && markdownFiles.length === 1) {
      return buildCanvasSelectionPrompt(
        selection,
        "Use the selected markdown file as the primary context and continue with the most helpful next step.",
        options,
      );
    }

    if (textBlocks.length !== 1) {
      throw new Error("New thread currently requires selecting exactly one text node, optionally with markdown file context, or exactly one markdown file.");
    }

    const text = String(textBlocks[0]?.text || "");
    if (!text.trim()) {
      throw new Error("The selected text node is empty.");
    }

    if (markdownFiles.length > 0) {
      return buildCanvasSelectionPrompt(selection, text, options);
    }

    return text;
  }

  truncateInline(value, maxLength) {
    const singleLine = String(value || "").replace(/\s+/g, " ").trim();
    if (!singleLine) {
      return "";
    }

    if (singleLine.length <= maxLength) {
      return singleLine;
    }

    return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
  }
};
