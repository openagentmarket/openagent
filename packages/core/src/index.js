"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  approvalPolicy: "never",
  sandboxMode: "workspace-write",
  model: null,
});
const CANVAS_BINDING_SCHEMA_VERSION = 1;
const SUPPORTED_SANDBOX_MODES = new Set([
  "workspace-write",
  "danger-full-access",
]);

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function normalizeCanvasSelection(input = {}) {
  const textBlocks = Array.isArray(input.textBlocks)
    ? input.textBlocks
        .map((block, index) => ({
          id: String(block?.id || `text-${index + 1}`),
          text: String(block?.text || "").trim(),
        }))
        .filter((block) => block.text)
    : [];

  const markdownFiles = Array.isArray(input.markdownFiles)
    ? input.markdownFiles
        .map((file, index) => ({
          id: String(file?.id || `file-${index + 1}`),
          path: String(file?.path || "").trim(),
          absolutePath: String(file?.absolutePath || "").trim(),
          name: String(file?.name || "").trim(),
          content: String(file?.content || ""),
        }))
        .filter((file) => file.path)
    : [];

  const warnings = Array.isArray(input.warnings)
    ? input.warnings.map((warning) => String(warning)).filter(Boolean)
    : [];

  const nodeIds = normalizeStringArray(input.nodeIds).sort();
  const canvasPath = String(input.canvasPath || "").trim();
  const title = String(input.title || "").trim() || deriveTitle(canvasPath, textBlocks, markdownFiles);

  return {
    canvasPath,
    canvasName: String(input.canvasName || "").trim(),
    nodeIds,
    textBlocks,
    markdownFiles,
    warnings,
    title,
  };
}

function normalizePromptPath(value) {
  return String(value || "").trim().replace(/\\/g, "/");
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

function deriveTitle(canvasPath, textBlocks, markdownFiles) {
  if (textBlocks.length > 0) {
    const firstLine = textBlocks[0].text.split("\n")[0].trim();
    if (firstLine) {
      return firstLine.slice(0, 80);
    }
  }

  if (markdownFiles.length > 0) {
    return markdownFiles[0].name || markdownFiles[0].path;
  }

  return canvasPath ? `${canvasPath} selection` : "Canvas selection";
}

function createSelectionKey(selectionContext) {
  const selection = normalizeCanvasSelection(selectionContext);
  return stableHash([
    selection.canvasPath,
    selection.nodeIds.join("\n"),
  ].join("\n\n"));
}

function createTaskId(selectionKey, cwd) {
  return `task:${stableHash(`${selectionKey}\0${String(cwd || "").trim()}`)}`;
}

function createPendingTaskId(selectionKey) {
  return `pending:${selectionKey}`;
}

function createFreshTaskId(selectionKey, cwd) {
  const nonce = `${nowIso()}\0${Math.random().toString(16)}`;
  return `task:${stableHash(`${selectionKey}\0${String(cwd || "").trim()}\0${nonce}`)}`;
}

function createFreshPendingTaskId(selectionKey) {
  const nonce = `${nowIso()}\0${Math.random().toString(16)}`;
  return `pending:${stableHash(`${selectionKey}\0${nonce}`)}`;
}

function normalizeCanvasResultNodeBinding(sourceNodeId, input = {}) {
  const normalizedSourceNodeId = String(sourceNodeId || input?.sourceNodeId || "").trim();
  const resultNodeId = String(input?.resultNodeId || "").trim();
  if (!normalizedSourceNodeId || !resultNodeId) {
    return null;
  }

  return {
    sourceNodeId: normalizedSourceNodeId,
    resultNodeId,
    edgeId: String(input?.edgeId || "").trim(),
    messageId: String(input?.messageId || "").trim(),
    syncSignature: String(input?.syncSignature || "").trim(),
    updatedAt: String(input?.updatedAt || "").trim(),
  };
}

function normalizeCanvasBinding(input = {}, selectionContext = {}) {
  const selection = normalizeCanvasSelection(selectionContext);
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const canvasPath = String(source.canvasPath || selection.canvasPath || "").trim();
  const rootNodeIds = normalizeStringArray(
    Array.isArray(source.rootNodeIds) ? source.rootNodeIds : selection.nodeIds
  ).sort();
  const activeSourceNodeId = String(
    source.activeSourceNodeId || (rootNodeIds.length === 1 ? rootNodeIds[0] : "")
  ).trim();
  const activeSourceUpdatedAt = String(source.activeSourceUpdatedAt || "").trim();

  const resultNodesBySourceNodeId = {};
  if (source.resultNodesBySourceNodeId && typeof source.resultNodesBySourceNodeId === "object" && !Array.isArray(source.resultNodesBySourceNodeId)) {
    Object.entries(source.resultNodesBySourceNodeId).forEach(([sourceNodeId, value]) => {
      const normalizedEntry = normalizeCanvasResultNodeBinding(sourceNodeId, value);
      if (normalizedEntry) {
        resultNodesBySourceNodeId[normalizedEntry.sourceNodeId] = normalizedEntry;
      }
    });
  }

  return {
    schemaVersion: CANVAS_BINDING_SCHEMA_VERSION,
    canvasPath,
    rootNodeIds,
    activeSourceNodeId,
    activeSourceUpdatedAt,
    resultNodesBySourceNodeId,
  };
}

function createTaskBinding({
  taskId,
  threadId = null,
  source = "obsidian-canvas",
  sourceRef = "",
  cwd = "",
  status = "needs-cwd",
  title = "Untitled task",
  selectionContext = {},
  currentTurnId = null,
  lastError = "",
  messages = [],
  runtimeConfig = DEFAULT_RUNTIME_CONFIG,
  canvasBinding = {},
  createdAt = nowIso(),
  updatedAt = createdAt,
}) {
  const normalizedSelection = normalizeCanvasSelection(selectionContext);
  const selectionKey = createSelectionKey(normalizedSelection);
  const normalizedRuntimeConfig = {
    approvalPolicy: String(runtimeConfig?.approvalPolicy || DEFAULT_RUNTIME_CONFIG.approvalPolicy),
    sandboxMode: SUPPORTED_SANDBOX_MODES.has(String(runtimeConfig?.sandboxMode || ""))
      ? String(runtimeConfig.sandboxMode)
      : DEFAULT_RUNTIME_CONFIG.sandboxMode,
  };

  return {
    taskId: taskId || (cwd ? createTaskId(selectionKey, cwd) : createPendingTaskId(selectionKey)),
    selectionKey,
    threadId,
    source,
    sourceRef: sourceRef || normalizedSelection.canvasPath,
    cwd: String(cwd || "").trim(),
    status,
    title: title || normalizedSelection.title,
    currentTurnId,
    lastError,
    messages: Array.isArray(messages) ? messages : [],
    runtimeConfig: normalizedRuntimeConfig,
    selectionContext: normalizedSelection,
    canvasBinding: normalizeCanvasBinding(canvasBinding, normalizedSelection),
    createdAt,
    updatedAt,
  };
}

function createChannelBinding({
  channelType,
  channelId,
  taskId,
  threadId = null,
  createdAt = nowIso(),
  updatedAt = createdAt,
}) {
  return {
    channelType: String(channelType || "").trim(),
    channelId: String(channelId || "").trim(),
    taskId: String(taskId || "").trim(),
    threadId: threadId ? String(threadId) : null,
    createdAt,
    updatedAt,
  };
}

function buildCanvasPrompt(selectionContext, userMessage = "", options = {}) {
  const selection = normalizeCanvasSelection(selectionContext);
  const trimmedMessage = String(userMessage || "").trim();
  const includeContext = options.forceContext !== false;
  const parts = [];

  if (includeContext) {
    parts.push("You are working from an Obsidian Canvas selection. Treat the following nodes as the task context.");

    if (selection.textBlocks.length > 0) {
      parts.push(
        selection.textBlocks
          .map((block, index) => `Text node ${index + 1}:\n${block.text}`)
          .join("\n\n")
      );
    }

    if (selection.markdownFiles.length > 0) {
      parts.push("Before answering, open and read each linked markdown file from disk. Use the file contents as required context, not just the link text.");
      parts.push(
        selection.markdownFiles
          .map((file, index) => buildMarkdownFilePromptBlock(file, index, options))
          .join("\n\n")
      );
    }

    if (selection.warnings.length > 0) {
      parts.push(`Resolver warnings:\n- ${selection.warnings.join("\n- ")}`);
    }
  }

  if (trimmedMessage) {
    if (shouldAppendUserRequest(selection.textBlocks, selection.markdownFiles, trimmedMessage, includeContext)) {
      parts.push(`User request:\n${trimmedMessage}`);
    }
  } else if (includeContext) {
    parts.push("Use the saved Canvas context and continue with the most helpful next step.");
  }

  return parts.join("\n\n").trim();
}

module.exports = {
  DEFAULT_RUNTIME_CONFIG,
  CANVAS_BINDING_SCHEMA_VERSION,
  SUPPORTED_SANDBOX_MODES,
  buildCanvasPrompt,
  createFreshPendingTaskId,
  createFreshTaskId,
  createChannelBinding,
  createPendingTaskId,
  createSelectionKey,
  createTaskBinding,
  createTaskId,
  deriveTitle,
  normalizeCanvasBinding,
  normalizeCanvasSelection,
  nowIso,
  stableHash,
};
