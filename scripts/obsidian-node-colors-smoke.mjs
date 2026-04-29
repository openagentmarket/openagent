import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ensureSmokeVaultReady, openObsidianVault, resolveSmokeVaultPath } from "./obsidian-vault-utils.mjs";

const repoRoot = process.cwd();
const vaultPath = resolveSmokeVaultPath();
process.env.OPENAGENT_OBSIDIAN_VAULT ||= vaultPath;
const smokeVaultRegistration = ensureSmokeVaultReady(vaultPath);
const smokeDirName = "OpenAgent Smoke";
const smokeDir = path.join(vaultPath, smokeDirName);
const controlDir = path.join(vaultPath, ".openagent");
const pluginDataPath = path.join(vaultPath, ".obsidian", "plugins", "openagent", "data.json");
const canvasFileName = "color-smoke.canvas";
const canvasPathRelative = `${smokeDirName}/${canvasFileName}`;
const requestPath = path.join(controlDir, "smoke-request.json");
const resultPath = path.join(controlDir, "smoke-result.json");
const requestId = `color-smoke-${Date.now()}`;
const sourceNodeId = "color-smoke-text";
const COMPLETED_CANVAS_NODE_COLOR = "#086ddd";

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
const task = await fetchTask(result.taskId);
assertTaskCanvasBinding(task, {
  canvasPath: canvasPathRelative,
  activeSourceNodeId: sourceNodeId,
  rootNodeIds: [sourceNodeId],
});
waitForNodeColor(sourceNodeId, COMPLETED_CANVAS_NODE_COLOR, 45_000);
waitForResultNodeForSource(sourceNodeId, 45_000);
const completedTask = await waitForTaskCompletion(result.taskId, 120_000);
assertTaskCanvasBinding(completedTask, {
  canvasPath: canvasPathRelative,
  activeSourceNodeId: sourceNodeId,
  rootNodeIds: [sourceNodeId],
  resultNodeBySourceNodeId: {
    [sourceNodeId]: `oa-result-`,
  },
});

console.log("Obsidian node color smoke passed.");
console.log(JSON.stringify({
  requestId,
  taskId: result.taskId,
  sourceNodeId,
  finalColor: readNodeColor(sourceNodeId),
  canvasPath: canvasPathRelative,
}, null, 2));

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
        id: sourceNodeId,
        type: "text",
        x: 0,
        y: 0,
        width: 420,
        height: 180,
        text: "Explain briefly why automated plugin smoke tests help close the loop for local Obsidian development.",
      },
    ],
    edges: [],
  };

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

function waitForResultNodeForSource(sourceId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      assertHasResultNodeForSource(sourceId);
      return;
    } catch (error) {
      lastError = error;
    }

    sleep(500);
  }

  throw lastError || new Error(`Timed out waiting for a result node linked from ${sourceId}.`);
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

  if (
    resultNode.openagent?.kind !== "assistant-result"
    || String(resultNode.openagent?.sourceNodeId || "") !== sourceId
  ) {
    throw new Error(`Result node is missing OpenAgent metadata for source node ${sourceId}.`);
  }

  if (
    resultEdge.openagent?.kind !== "result-edge"
    || String(resultEdge.openagent?.sourceNodeId || "") !== sourceId
    || String(resultEdge.openagent?.resultNodeId || "") !== String(resultNode.id || "")
  ) {
    throw new Error(`Result edge is missing OpenAgent metadata for source node ${sourceId}.`);
  }
}

async function waitForTaskCompletion(taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await fetchTask(taskId);
    if (
      task
      && String(task?.threadId || "").trim()
      && !String(task?.currentTurnId || "").trim()
      && String(task?.status || "") === "idle"
      && String(task?.canvasBinding?.resultNodesBySourceNodeId?.[sourceNodeId]?.resultNodeId || "").trim()
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

function assertTaskCanvasBinding(task, expected) {
  const binding = task?.canvasBinding || {};
  if (String(binding.canvasPath || "") !== String(expected.canvasPath || "")) {
    throw new Error(`Expected canvasBinding.canvasPath=${expected.canvasPath}, received ${binding.canvasPath || "(empty)"}`);
  }

  if (String(binding.activeSourceNodeId || "") !== String(expected.activeSourceNodeId || "")) {
    throw new Error(`Expected canvasBinding.activeSourceNodeId=${expected.activeSourceNodeId}, received ${binding.activeSourceNodeId || "(empty)"}`);
  }

  const actualRootNodeIds = Array.isArray(binding.rootNodeIds) ? [...binding.rootNodeIds].map(String).sort() : [];
  const expectedRootNodeIds = Array.isArray(expected.rootNodeIds) ? [...expected.rootNodeIds].map(String).sort() : [];
  if (JSON.stringify(actualRootNodeIds) !== JSON.stringify(expectedRootNodeIds)) {
    throw new Error(`Expected canvasBinding.rootNodeIds=${JSON.stringify(expectedRootNodeIds)}, received ${JSON.stringify(actualRootNodeIds)}`);
  }

  if (expected.resultNodeBySourceNodeId && typeof expected.resultNodeBySourceNodeId === "object") {
    Object.entries(expected.resultNodeBySourceNodeId).forEach(([sourceNodeId, expectedResultNodeId]) => {
      const actualResultNodeId = String(binding?.resultNodesBySourceNodeId?.[sourceNodeId]?.resultNodeId || "");
      if (!actualResultNodeId) {
        throw new Error(`Expected canvasBinding.resultNodesBySourceNodeId[${sourceNodeId}] to be present.`);
      }

      if (String(expectedResultNodeId).endsWith("-") ? !actualResultNodeId.startsWith(String(expectedResultNodeId)) : actualResultNodeId !== String(expectedResultNodeId)) {
        throw new Error(`Expected canvasBinding.resultNodesBySourceNodeId[${sourceNodeId}] = ${expectedResultNodeId}, received ${actualResultNodeId}`);
      }
    });
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
