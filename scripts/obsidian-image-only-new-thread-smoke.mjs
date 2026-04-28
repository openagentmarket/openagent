import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { ensureSmokeVaultReady, openObsidianVault, resolveSmokeVaultPath } from "./obsidian-vault-utils.mjs";

import { writeVisualSmokePng } from "./lib/visual-smoke-image.mjs";

const repoRoot = process.cwd();
const vaultPath = resolveSmokeVaultPath();
process.env.OPENAGENT_OBSIDIAN_VAULT ||= vaultPath;
const smokeVaultRegistration = ensureSmokeVaultReady(vaultPath);
const smokeDirName = "OpenAgent Smoke";
const smokeDir = path.join(vaultPath, smokeDirName);
const controlDir = path.join(vaultPath, ".openagent");
const pluginDataPath = path.join(vaultPath, ".obsidian", "plugins", "openagent", "data.json");
const requestPath = path.join(controlDir, "smoke-request.json");
const resultPath = path.join(controlDir, "smoke-result.json");
const requestId = `image-only-thread-smoke-${Date.now()}`;
const fixtureBaseName = requestId;
const canvasFileName = `${fixtureBaseName}.canvas`;
const canvasPathRelative = `${smokeDirName}/${canvasFileName}`;
const imageFileName = `${fixtureBaseName}.png`;
const imagePathRelative = `${smokeDirName}/${imageFileName}`;
const imageAbsolutePath = path.join(smokeDir, imageFileName);
const imageNodeId = "image-only-smoke-file";
const COMPLETED_CANVAS_NODE_COLOR = "#086ddd";

await main();

async function main() {
  linkPlugin();
  writeFixtureFiles();
  writeSmokeRequest();
  restartObsidian();

  const result = waitForResult(requestId, resultPath, 120_000);
  if (result.status !== "ok") {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  assertSmokeResult(result);
  const task = await waitForTaskCompletion(result.taskId, 120_000);
  assertTask(task);
  waitForNodeColor(imageNodeId, COMPLETED_CANVAS_NODE_COLOR, 45_000);
  assertHasResultNodeForSource(imageNodeId);

  console.log("Obsidian image-only new-thread smoke passed.");
  console.log(JSON.stringify({
    requestId,
    taskId: task.taskId,
    threadId: task.threadId,
    status: task.status,
    canvasPath: canvasPathRelative,
    imagePath: imagePathRelative,
    nodeIds: task.selectionContext?.nodeIds || [],
    selectionDebug: result.selectionDebug,
    selectionSummary: result.selectionSummary,
    finalColor: readNodeColor(imageNodeId),
  }, null, 2));
}

function linkPlugin() {
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "link-obsidian-plugin.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function enableDevSmokeRequests() {
  fs.mkdirSync(path.dirname(pluginDataPath), { recursive: true });
  let existingState = {};
  if (fs.existsSync(pluginDataPath)) {
    try {
      existingState = JSON.parse(fs.readFileSync(pluginDataPath, "utf8"));
    } catch {
      existingState = {};
    }
  }

  fs.writeFileSync(pluginDataPath, `${JSON.stringify({
    ...existingState,
    settings: {
      ...(existingState.settings || {}),
      enableDevSmokeRequests: true,
    },
  }, null, 2)}\n`, "utf8");
}

function writeFixtureFiles() {
  fs.mkdirSync(smokeDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });

  const canvas = {
    nodes: [
      {
        id: imageNodeId,
        type: "file",
        x: 0,
        y: 0,
        width: 420,
        height: 240,
        file: imagePathRelative,
      },
    ],
    edges: [],
  };

  writeVisualSmokePng(imageAbsolutePath);
  fs.writeFileSync(path.join(smokeDir, canvasFileName), `${JSON.stringify(canvas, null, 2)}\n`, "utf8");
  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }
}

function writeSmokeRequest() {
  const request = {
    id: requestId,
    canvasPath: canvasPathRelative,
    nodeIds: [imageNodeId],
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
  enableDevSmokeRequests();
  execFileSync("open", ["-a", "Obsidian"], { stdio: "ignore" });
  openObsidianVault(vaultPath, { vaultId: smokeVaultRegistration.vaultId });
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

function assertSmokeResult(result) {
  const prompt = String(result?.rawPrompt || "");
  const selectionDebug = String(result?.selectionDebug || "");
  const selectionSummary = String(result?.selectionSummary || "");

  if (!selectionDebug.includes("text=0") || !selectionDebug.includes("images=1")) {
    throw new Error(`Unexpected selection debug payload: ${selectionDebug || "(empty)"}`);
  }

  if (!selectionSummary.includes("1 image file")) {
    throw new Error(`Unexpected selection summary: ${selectionSummary || "(empty)"}`);
  }

  if (prompt !== "") {
    throw new Error(`Expected empty raw prompt for image-only selection, received: ${prompt}`);
  }
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
      && Array.isArray(task?.selectionContext?.imageFiles)
      && task.selectionContext.imageFiles.length === 1
      && assistantMessages.length > 0
    ) {
      return task;
    }

    await sleepAsync(1_000);
  }

  throw new Error(`Timed out waiting for task completion for ${taskId}.`);
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
    throw new Error(`Result node for ${sourceId} was missing or empty.`);
  }
}

function readCanvas() {
  return JSON.parse(fs.readFileSync(path.join(smokeDir, canvasFileName), "utf8"));
}

function assertTask(task) {
  if (!task) {
    throw new Error("Smoke task could not be fetched.");
  }

  const textBlocks = Array.isArray(task?.selectionContext?.textBlocks) ? task.selectionContext.textBlocks : [];
  const markdownFiles = Array.isArray(task?.selectionContext?.markdownFiles) ? task.selectionContext.markdownFiles : [];
  const imageFiles = Array.isArray(task?.selectionContext?.imageFiles) ? task.selectionContext.imageFiles : [];
  const nodeIds = Array.isArray(task?.selectionContext?.nodeIds) ? task.selectionContext.nodeIds : [];

  if (textBlocks.length !== 0) {
    throw new Error(`Expected 0 selected text blocks on the task, received ${textBlocks.length}.`);
  }

  if (markdownFiles.length !== 0) {
    throw new Error(`Expected 0 markdown files on the task, received ${markdownFiles.length}.`);
  }

  if (imageFiles.length !== 1) {
    throw new Error(`Expected 1 selected image file on the task, received ${imageFiles.length}.`);
  }

  if (nodeIds.length !== 1 || nodeIds[0] !== imageNodeId) {
    throw new Error(`Unexpected task node ids: ${JSON.stringify(nodeIds)}`);
  }

  if (String(imageFiles[0]?.id || "") !== imageNodeId) {
    throw new Error(`Unexpected image node id: ${String(imageFiles[0]?.id || "")}`);
  }

  if (String(imageFiles[0]?.path || "") !== imagePathRelative) {
    throw new Error(`Unexpected image path: ${String(imageFiles[0]?.path || "")}`);
  }

  if (String(imageFiles[0]?.absolutePath || "") !== imageAbsolutePath) {
    throw new Error(`Unexpected image absolute path: ${String(imageFiles[0]?.absolutePath || "")}`);
  }

  if (String(imageFiles[0]?.mimeType || "") !== "image/png") {
    throw new Error(`Unexpected image mime type: ${String(imageFiles[0]?.mimeType || "")}`);
  }

  if (String(task?.title || "") !== imageFileName.replace(/\.png$/i, "")) {
    throw new Error(`Unexpected task title: ${String(task?.title || "")}`);
  }

  if (String(task?.cwd || "") !== repoRoot) {
    throw new Error(`Unexpected task cwd: ${String(task?.cwd || "")}`);
  }
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
