import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const vaultPath = resolveOpenVaultPath();
const smokeDirName = "OpenAgent Smoke";
const smokeDir = path.join(vaultPath, smokeDirName);
const controlDir = path.join(vaultPath, ".openagent");
const requestPath = path.join(controlDir, "smoke-request.json");
const resultPath = path.join(controlDir, "smoke-result.json");
const requestId = `markdown-thread-smoke-${Date.now()}`;
const fixtureBaseName = requestId;
const canvasFileName = `${fixtureBaseName}.canvas`;
const canvasPathRelative = `${smokeDirName}/${canvasFileName}`;
const markdownFileName = `${fixtureBaseName}.md`;
const markdownPathRelative = `${smokeDirName}/${markdownFileName}`;
const markdownAbsolutePath = path.join(smokeDir, markdownFileName);
const sourceNodeId = "markdown-smoke-file";
const expectedMarkdownSnippet = "Include the exact phrase MARKDOWN_THREAD_OK in a short reply.";
const expectedAssistantSnippet = "MARKDOWN_THREAD_OK";
const COMPLETED_CANVAS_NODE_COLOR = "#086ddd";

await main();

async function main() {
  linkPlugin();
  writeFixtureFiles();
  writeSmokeRequest();
  restartObsidian();

  waitForNodeColor(sourceNodeId, "3", 45_000);
  const result = waitForResult(requestId, resultPath, 120_000);
  if (result.status !== "ok") {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  assertSmokePrompt(result);
  const task = await waitForTaskCompletion(result.taskId, 120_000);
  waitForNodeColor(sourceNodeId, COMPLETED_CANVAS_NODE_COLOR, 45_000);
  assertHasResultNodeForSource(sourceNodeId);

  console.log("Obsidian markdown new-thread smoke passed.");
  console.log(JSON.stringify({
    requestId,
    taskId: task.taskId,
    threadId: task.threadId,
    status: task.status,
    sourceNodeId,
    selectionDebug: result.selectionDebug,
    finalColor: readNodeColor(sourceNodeId),
    canvasPath: canvasPathRelative,
  }, null, 2));
}

function linkPlugin() {
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "link-obsidian-plugin.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function writeFixtureFiles() {
  fs.mkdirSync(smokeDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });

  const markdownContent = [
    "---",
    "name: markdown-thread-smoke",
    "description: Dedicated smoke fixture for markdown-only new-thread coverage.",
    "---",
    "",
    "# Markdown New Thread Smoke",
    "",
    expectedMarkdownSnippet,
    "",
    "Keep the response brief.",
    "Do not inspect the repo or run tools.",
    "Reply in one sentence.",
    "",
  ].join("\n");

  const canvas = {
    nodes: [
      {
        id: sourceNodeId,
        type: "file",
        x: 0,
        y: 0,
        width: 460,
        height: 320,
        file: markdownPathRelative,
      },
    ],
    edges: [],
  };

  fs.writeFileSync(path.join(smokeDir, markdownFileName), markdownContent, "utf8");
  fs.writeFileSync(path.join(smokeDir, canvasFileName), `${JSON.stringify(canvas, null, 2)}\n`, "utf8");
  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }
}

function writeSmokeRequest() {
  const request = {
    id: requestId,
    canvasPath: canvasPathRelative,
    nodeIds: [sourceNodeId],
    cwd: repoRoot,
    forceNewTask: true,
    mode: "new-thread",
    runTask: true,
  };

  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
}

function restartObsidian() {
  spawnSync("osascript", ["-e", 'tell application "Obsidian" to quit'], { stdio: "ignore" });
  waitForObsidianProcess(false, 15_000);
  execFileSync("open", ["-a", "Obsidian"], { stdio: "ignore" });
  waitForObsidianProcess(true, 20_000);
}

function waitForObsidianProcess(shouldExist, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = spawnSync("pgrep", ["-x", "Obsidian"], { stdio: "ignore" }).status === 0;
    if (running === shouldExist) {
      return;
    }

    sleep(500);
  }

  throw new Error(shouldExist ? "Obsidian did not start in time." : "Obsidian did not quit in time.");
}

function waitForResult(expectedRequestId, filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed?.requestId === expectedRequestId || (!parsed?.requestId && parsed?.status === "error")) {
        return parsed;
      }
    }

    sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${filePath}`);
}

function assertSmokePrompt(result) {
  const prompt = String(result?.rawPrompt || "");
  const selectionDebug = String(result?.selectionDebug || "");

  if (!selectionDebug.includes("text=0") || !selectionDebug.includes("files=1")) {
    throw new Error(`Unexpected selection debug payload: ${selectionDebug || "(empty)"}`);
  }

  if (shouldUseMarkdownReference()) {
    const expectedLink = `Markdown file 1: [${path.basename(markdownFileName, ".md")}](<${markdownPathRelative}>)`;
    if (!prompt.includes(expectedLink)) {
      throw new Error("Smoke raw prompt did not include the selected markdown file link.");
    }
  } else if (!prompt.includes(expectedMarkdownSnippet)) {
    throw new Error("Smoke raw prompt did not include the expected markdown file fallback content.");
  }
}

async function waitForTaskCompletion(taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const task = await fetchTask(taskId);
    const assistantMessages = Array.isArray(task?.messages)
      ? task.messages.filter((message) => String(message?.role || "") === "assistant" && String(message?.text || "").trim())
      : [];
    if (
      task
      && String(task?.threadId || "").trim()
      && !String(task?.currentTurnId || "").trim()
      && String(task?.status || "") === "idle"
      && Array.isArray(task?.selectionContext?.markdownFiles)
      && task.selectionContext.markdownFiles.length === 1
      && assistantMessages.some((message) => String(message.text || "").includes(expectedAssistantSnippet))
    ) {
      return task;
    }

    await sleepAsync(1_000);
  }

  throw new Error(`Timed out waiting for task completion for ${taskId}.`);
}

async function fetchTask(taskId) {
  const configPath = path.join(os.homedir(), ".openagent", "daemon-config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const response = await fetch(`http://${config.host}:${config.port}/tasks/${encodeURIComponent(taskId)}`, {
    headers: {
      "x-openagent-token": config.token,
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch task ${taskId}: ${response.status}`);
  }

  const payload = await response.json();
  return payload?.task || null;
}

function waitForNodeColor(nodeId, expectedColor, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readNodeColor(nodeId) === expectedColor) {
      return;
    }

    sleep(500);
  }

  throw new Error(`Timed out waiting for node ${nodeId} to reach color ${expectedColor}.`);
}

function readNodeColor(nodeId) {
  const parsed = readCanvas();
  const node = Array.isArray(parsed?.nodes)
    ? parsed.nodes.find((entry) => String(entry?.id || "") === nodeId)
    : null;
  return node && Object.prototype.hasOwnProperty.call(node, "color")
    ? String(node.color)
    : "";
}

function assertHasResultNodeForSource(sourceId) {
  const parsed = readCanvas();
  const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const resultEdge = edges.find((edge) => (
    String(edge?.fromNode || "") === sourceId
    && String(edge?.toNode || "").startsWith("oa-result-")
  ));
  if (!resultEdge) {
    throw new Error(`No result edge found for source node ${sourceId}.`);
  }

  const resultNode = nodes.find((node) => String(node?.id || "") === String(resultEdge.toNode || ""));
  if (!resultNode || String(resultNode?.type || "") !== "text" || !String(resultNode?.text || "").trim()) {
    throw new Error(`Result node is missing or empty for source node ${sourceId}.`);
  }
}

function readCanvas() {
  const canvasPath = path.join(smokeDir, canvasFileName);
  let lastError = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return JSON.parse(fs.readFileSync(canvasPath, "utf8"));
    } catch (error) {
      lastError = error;
      sleep(100);
    }
  }

  throw lastError || new Error(`Unable to read ${canvasPath}`);
}

function resolveOpenVaultPath() {
  const configPath = path.join(os.homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const openVaultEntry = Object.values(parsed?.vaults || {}).find((vault) => vault?.open && vault?.path);
  if (!openVaultEntry?.path) {
    throw new Error("No open Obsidian vault was found in obsidian.json.");
  }

  return path.resolve(String(openVaultEntry.path));
}

function shouldUseMarkdownReference() {
  const relativePath = path.relative(repoRoot, markdownAbsolutePath);
  return relativePath === ""
    || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function sleep(ms) {
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, ms);
}

function sleepAsync(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
