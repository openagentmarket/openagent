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
const requestPath = path.join(controlDir, "smoke-request.json");
const resultPath = path.join(controlDir, "smoke-result.json");
const requestBaseId = `follow-up-chain-smoke-${Date.now()}`;
const canvasFileName = `${requestBaseId}.canvas`;
const canvasPathRelative = `${smokeDirName}/${canvasFileName}`;
const sourceNodeId = "follow-up-source";
const followUpNodeId = "follow-up-message";
const expectedSourceReply = "SOURCE_CHAIN_OK";
const expectedFollowUpReply = "FOLLOW_UP_CHAIN_OK";
const COMPLETED_CANVAS_NODE_COLOR = "#086ddd";

await main();

async function main() {
  linkPlugin();
  writeFixtureFiles();
  restartObsidian();

  const firstRequestId = `${requestBaseId}-initial`;
  writeSmokeRequest({
    requestId: firstRequestId,
    nodeIds: [sourceNodeId],
  });

  waitForNodeColor(sourceNodeId, "3", 45_000);
  const firstResult = waitForResult(firstRequestId, 120_000);
  if (firstResult.status !== "ok") {
    throw new Error(`Initial smoke request failed: ${JSON.stringify(firstResult)}`);
  }

  const firstTask = await waitForTaskCompletion(firstResult.taskId, expectedSourceReply, 120_000, {
    minUserMessages: 1,
  });
  assertTaskCanvasBinding(firstTask, {
    canvasPath: canvasPathRelative,
    activeSourceNodeId: sourceNodeId,
    rootNodeIds: [sourceNodeId],
  });
  waitForNodeColor(sourceNodeId, COMPLETED_CANVAS_NODE_COLOR, 45_000);
  const firstResultNode = waitForResultNodeForSource(sourceNodeId, 45_000);
  assertOpenAgentResultMetadata(firstResultNode, sourceNodeId, firstTask.taskId);

  appendFollowUpNode(firstResultNode.id);
  restartObsidian();

  const secondRequestId = `${requestBaseId}-follow-up`;
  writeSmokeRequest({
    requestId: secondRequestId,
    nodeIds: [followUpNodeId],
  });

  waitForNodeColor(followUpNodeId, "3", 45_000);
  assertNoPrematureFollowUpResult(expectedSourceReply);
  const secondResult = waitForResult(secondRequestId, 120_000);
  if (secondResult.status !== "ok") {
    throw new Error(`Follow-up smoke request failed: ${JSON.stringify(secondResult)}`);
  }

  if (String(secondResult.mode || "") !== "follow-up") {
    throw new Error(`Expected follow-up mode, received ${secondResult.mode || "(empty)"}`);
  }

  if (secondResult.taskId !== firstTask.taskId) {
    throw new Error(`Expected follow-up to reuse task ${firstTask.taskId}, received ${secondResult.taskId}`);
  }

  const secondTask = await waitForTaskCompletion(secondResult.taskId, expectedFollowUpReply, 120_000, {
    minUserMessages: 2,
  });
  assertTaskCanvasBinding(secondTask, {
    canvasPath: canvasPathRelative,
    activeSourceNodeId: followUpNodeId,
    rootNodeIds: [sourceNodeId],
    resultNodeBySourceNodeId: {
      [sourceNodeId]: firstResultNode.id,
    },
  });
  waitForNodeColor(followUpNodeId, COMPLETED_CANVAS_NODE_COLOR, 45_000);
  const followUpResultNode = waitForResultNodeForSource(followUpNodeId, 45_000);
  if (!String(followUpResultNode.text || "").includes(expectedFollowUpReply)) {
    throw new Error("Follow-up result node did not contain the expected assistant reply.");
  }
  assertOpenAgentResultMetadata(followUpResultNode, followUpNodeId, secondTask.taskId);
  const finalTask = await waitForCanvasBinding(secondTask.taskId, {
    canvasPath: canvasPathRelative,
    activeSourceNodeId: followUpNodeId,
    rootNodeIds: [sourceNodeId],
    resultNodeBySourceNodeId: {
      [sourceNodeId]: firstResultNode.id,
      [followUpNodeId]: followUpResultNode.id,
    },
  });
  assertTaskCanvasBinding(finalTask, {
    canvasPath: canvasPathRelative,
    activeSourceNodeId: followUpNodeId,
    rootNodeIds: [sourceNodeId],
    resultNodeBySourceNodeId: {
      [sourceNodeId]: firstResultNode.id,
      [followUpNodeId]: followUpResultNode.id,
    },
  });

  console.log("Obsidian follow-up chain smoke passed.");
  console.log(JSON.stringify({
    initialTaskId: firstTask.taskId,
    followUpTaskId: secondTask.taskId,
    threadId: secondTask.threadId,
    canvasPath: canvasPathRelative,
    sourceNodeId,
    followUpNodeId,
    initialResultNodeId: firstResultNode.id,
    followUpResultNodeId: followUpResultNode.id,
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
        id: sourceNodeId,
        type: "text",
        x: 0,
        y: 0,
        width: 420,
        height: 180,
        text: "Reply with SOURCE_CHAIN_OK only.",
      },
    ],
    edges: [],
  };

  fs.writeFileSync(path.join(smokeDir, canvasFileName), `${JSON.stringify(canvas, null, 2)}\n`, "utf8");
  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }
}

function appendFollowUpNode(resultNodeId) {
  const parsed = readCanvas();
  const nodes = Array.isArray(parsed?.nodes) ? [...parsed.nodes] : [];
  const edges = Array.isArray(parsed?.edges) ? [...parsed.edges] : [];
  const resultNode = nodes.find((node) => String(node?.id || "") === resultNodeId);
  if (!resultNode) {
    throw new Error(`Unable to find initial result node ${resultNodeId}.`);
  }

  nodes.push({
    id: followUpNodeId,
    type: "text",
    x: Number(resultNode.x || 0),
    y: Number(resultNode.y || 0) + Number(resultNode.height || 180) + 40,
    width: 420,
    height: 180,
    text: "Reply with FOLLOW_UP_CHAIN_OK only.",
  });
  edges.push({
    id: `${requestBaseId}-follow-up-edge`,
    fromNode: resultNodeId,
    toNode: followUpNodeId,
    fromSide: "bottom",
    toSide: "top",
  });

  writeCanvas({
    ...parsed,
    nodes,
    edges,
  });
}

function writeSmokeRequest({ requestId, nodeIds }) {
  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }

  const request = {
    id: requestId,
    canvasPath: canvasPathRelative,
    nodeIds,
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

function waitForResult(expectedRequestId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(resultPath)) {
      const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      if (parsed?.requestId === expectedRequestId || (!parsed?.requestId && parsed?.status === "error")) {
        return parsed;
      }
    }

    sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${resultPath}`);
}

async function waitForTaskCompletion(taskId, assistantSnippet, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const minimumUserMessages = Number(options.minUserMessages || 1);

  while (Date.now() < deadline) {
    const task = await fetchTask(taskId);
    const userMessages = Array.isArray(task?.messages)
      ? task.messages.filter((message) => String(message?.role || "") === "user" && String(message?.text || "").trim())
      : [];
    const assistantMessages = Array.isArray(task?.messages)
      ? task.messages.filter((message) => String(message?.role || "") === "assistant" && String(message?.text || "").trim())
      : [];
    if (
      task
      && String(task?.threadId || "").trim()
      && !String(task?.currentTurnId || "").trim()
      && String(task?.status || "") === "idle"
      && userMessages.length >= minimumUserMessages
      && assistantMessages.some((message) => String(message.text || "").includes(assistantSnippet))
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

async function waitForCanvasBinding(taskId, expected, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await fetchTask(taskId);
    if (doesTaskCanvasBindingMatch(task, expected)) {
      return task;
    }

    await sleepAsync(500);
  }

  throw new Error(`Timed out waiting for canvasBinding on ${taskId}.`);
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
  while (Date.now() < deadline) {
    const resultNode = findResultNodeForSource(sourceId);
    if (resultNode) {
      return resultNode;
    }

    sleep(500);
  }

  throw new Error(`Timed out waiting for a result node linked from ${sourceId}.`);
}

function findResultNodeForSource(sourceId) {
  const parsed = readCanvas();
  const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const resultEdge = edges.find((edge) => (
    String(edge?.fromNode || "") === sourceId
    && String(edge?.toNode || "").startsWith("oa-result-")
  ));
  if (!resultEdge) {
    return null;
  }

  return nodes.find((node) => String(node?.id || "") === String(resultEdge.toNode || "")) || null;
}

function assertOpenAgentResultMetadata(resultNode, sourceId, taskId) {
  if (
    resultNode?.openagent?.kind !== "assistant-result"
    || String(resultNode.openagent?.sourceNodeId || "") !== sourceId
    || String(resultNode.openagent?.taskId || "") !== taskId
  ) {
    throw new Error(`Result node is missing OpenAgent metadata for ${sourceId}.`);
  }
}

function assertNoPrematureFollowUpResult(previousReplySnippet) {
  const followUpResultNode = findResultNodeForSource(followUpNodeId);
  if (followUpResultNode && String(followUpResultNode.text || "").includes(previousReplySnippet)) {
    throw new Error("Follow-up result node was populated with the previous assistant reply before the new turn completed.");
  }
}

function assertTaskCanvasBinding(task, expected) {
  if (!doesTaskCanvasBindingMatch(task, expected)) {
    const binding = task?.canvasBinding || {};
    if (String(binding.canvasPath || "") !== String(expected.canvasPath || "")) {
      throw new Error(`Expected canvasBinding.canvasPath=${expected.canvasPath}, received ${binding.canvasPath || "(empty)"}`);
    }

    if (String(binding.activeSourceNodeId || "") !== String(expected.activeSourceNodeId || "")) {
      throw new Error(`Expected canvasBinding.activeSourceNodeId=${expected.activeSourceNodeId}, received ${binding.activeSourceNodeId || "(empty)"}`);
    }

    const actualResultNodeId = Object.entries(expected.resultNodeBySourceNodeId || {}).map(([sourceNodeId]) => {
      return `${sourceNodeId}=${String(binding?.resultNodesBySourceNodeId?.[sourceNodeId]?.resultNodeId || "(empty)")}`;
    }).join(", ");
    throw new Error(`canvasBinding mismatch: ${actualResultNodeId || "unexpected state"}`);
  }
}

function doesTaskCanvasBindingMatch(task, expected) {
  const binding = task?.canvasBinding || {};
  if (String(binding.canvasPath || "") !== String(expected.canvasPath || "")) {
    return false;
  }

  if (String(binding.activeSourceNodeId || "") !== String(expected.activeSourceNodeId || "")) {
    return false;
  }

  const actualRootNodeIds = Array.isArray(binding.rootNodeIds) ? [...binding.rootNodeIds].map(String).sort() : [];
  const expectedRootNodeIds = Array.isArray(expected.rootNodeIds) ? [...expected.rootNodeIds].map(String).sort() : [];
  if (JSON.stringify(actualRootNodeIds) !== JSON.stringify(expectedRootNodeIds)) {
    return false;
  }

  if (expected.resultNodeBySourceNodeId && typeof expected.resultNodeBySourceNodeId === "object") {
    for (const [sourceNodeId, resultNodeId] of Object.entries(expected.resultNodeBySourceNodeId)) {
      const actualResultNodeId = String(binding?.resultNodesBySourceNodeId?.[sourceNodeId]?.resultNodeId || "");
      if (actualResultNodeId !== String(resultNodeId || "")) {
        return false;
      }
    }
  }

  return true;
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

function writeCanvas(canvas) {
  const canvasPath = path.join(smokeDir, canvasFileName);
  fs.writeFileSync(canvasPath, `${JSON.stringify(canvas, null, 2)}\n`, "utf8");
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
