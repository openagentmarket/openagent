import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
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
const requestBaseId = `fork-branch-smoke-${Date.now()}`;
const canvasFileName = `${requestBaseId}.canvas`;
const canvasPathRelative = `${smokeDirName}/${canvasFileName}`;
const sourceNodeId = "fork-source";
const followUpNodeId = "fork-follow-up";
const branchNodeId = "fork-branch";
const expectedSourceReply = "FORK_SOURCE_OK";
const expectedFollowUpReply = "FORK_FOLLOW_UP_OK";
const expectedBranchReply = "FORK_BRANCH_OK";
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
  assertOkResult(firstResult, "Initial");
  const firstTask = await waitForTaskCompletion(firstResult.taskId, expectedSourceReply, 120_000, {
    minUserMessages: 1,
  });
  waitForNodeColor(sourceNodeId, COMPLETED_CANVAS_NODE_COLOR, 45_000);
  const firstResultNode = waitForResultNodeForSource(sourceNodeId, 45_000);
  assertOpenAgentResultMetadata(firstResultNode, sourceNodeId, firstTask.taskId);

  appendTextNodeFromResult({
    id: followUpNodeId,
    resultNodeId: firstResultNode.id,
    text: "Reply with FORK_FOLLOW_UP_OK only.",
    yOffset: 40,
  });
  restartObsidian();

  const followUpRequestId = `${requestBaseId}-follow-up`;
  writeSmokeRequest({
    requestId: followUpRequestId,
    nodeIds: [followUpNodeId],
  });

  waitForNodeColor(followUpNodeId, "3", 45_000);
  const followUpResult = waitForResult(followUpRequestId, 120_000);
  assertOkResult(followUpResult, "Follow-up");
  if (String(followUpResult.mode || "") !== "follow-up") {
    throw new Error(`Expected normal follow-up mode, received ${followUpResult.mode || "(empty)"}`);
  }
  if (followUpResult.taskId !== firstTask.taskId) {
    throw new Error(`Expected follow-up to reuse task ${firstTask.taskId}, received ${followUpResult.taskId}`);
  }
  const followUpTask = await waitForTaskCompletion(followUpResult.taskId, expectedFollowUpReply, 120_000, {
    minUserMessages: 2,
  });
  waitForNodeColor(followUpNodeId, COMPLETED_CANVAS_NODE_COLOR, 45_000);

  appendTextNodeFromResult({
    id: branchNodeId,
    resultNodeId: firstResultNode.id,
    text: "Reply with FORK_BRANCH_OK only.",
    yOffset: 260,
  });
  restartObsidian();

  const branchRequestId = `${requestBaseId}-branch`;
  writeSmokeRequest({
    requestId: branchRequestId,
    nodeIds: [branchNodeId],
    forkBehavior: "fork",
  });

  waitForNodeColor(branchNodeId, "3", 45_000);
  const branchResult = waitForResult(branchRequestId, 120_000);
  assertOkResult(branchResult, "Branch");
  if (String(branchResult.mode || "") !== "fork") {
    throw new Error(`Expected fork mode, received ${branchResult.mode || "(empty)"}`);
  }
  if (branchResult.taskId === firstTask.taskId) {
    throw new Error("Expected fork branch to create a new task.");
  }

  const branchTask = await waitForTaskCompletion(branchResult.taskId, expectedBranchReply, 120_000, {
    minUserMessages: 2,
  });
  if (!String(branchTask.threadId || "").trim() || branchTask.threadId === followUpTask.threadId) {
    throw new Error("Expected fork branch to create a distinct Codex thread.");
  }
  assertTaskDoesNotContain(branchTask, expectedFollowUpReply);
  waitForNodeColor(branchNodeId, COMPLETED_CANVAS_NODE_COLOR, 45_000);
  const branchResultNode = waitForResultNodeForSource(branchNodeId, 45_000);
  assertOpenAgentResultMetadata(branchResultNode, branchNodeId, branchTask.taskId);

  console.log("Obsidian fork branch smoke passed.");
  console.log(JSON.stringify({
    sourceTaskId: firstTask.taskId,
    sourceThreadId: followUpTask.threadId,
    forkTaskId: branchTask.taskId,
    forkThreadId: branchTask.threadId,
    canvasPath: canvasPathRelative,
    sourceNodeId,
    followUpNodeId,
    branchNodeId,
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

  writeCanvas({
    nodes: [
      {
        id: sourceNodeId,
        type: "text",
        x: 0,
        y: 0,
        width: 420,
        height: 180,
        text: "Reply with FORK_SOURCE_OK only.",
      },
    ],
    edges: [],
  });
  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }
}

function appendTextNodeFromResult({ id, resultNodeId, text, yOffset }) {
  const parsed = readCanvas();
  const nodes = Array.isArray(parsed?.nodes) ? [...parsed.nodes] : [];
  const edges = Array.isArray(parsed?.edges) ? [...parsed.edges] : [];
  const resultNode = nodes.find((node) => String(node?.id || "") === resultNodeId);
  if (!resultNode) {
    throw new Error(`Unable to find result node ${resultNodeId}.`);
  }

  nodes.push({
    id,
    type: "text",
    x: Number(resultNode.x || 0) + Number(resultNode.width || 420) + 80,
    y: Number(resultNode.y || 0) + yOffset,
    width: 420,
    height: 180,
    text,
  });
  edges.push({
    id: `${requestBaseId}-${id}-edge`,
    fromNode: resultNodeId,
    toNode: id,
    fromSide: "right",
    toSide: "left",
  });

  writeCanvas({
    ...parsed,
    nodes,
    edges,
  });
}

function writeSmokeRequest({ requestId, nodeIds, forkBehavior = "" }) {
  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }

  fs.writeFileSync(requestPath, `${JSON.stringify({
    id: requestId,
    canvasPath: canvasPathRelative,
    nodeIds,
    cwd: repoRoot,
    forceNewTask: true,
    mode: "new-thread",
    runTask: true,
    ...(forkBehavior ? { forkBehavior } : {}),
  }, null, 2)}\n`, "utf8");
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
  const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".openagent", "daemon-config.json"), "utf8"));
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
  const node = readCanvas().nodes.find((entry) => String(entry?.id || "") === nodeId);
  return node && Object.prototype.hasOwnProperty.call(node, "color") ? String(node.color) : "";
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
  const resultEdge = parsed.edges.find((edge) => (
    String(edge?.fromNode || "") === sourceId
    && String(edge?.toNode || "").startsWith("oa-result-")
  ));
  return resultEdge
    ? parsed.nodes.find((node) => String(node?.id || "") === String(resultEdge.toNode || "")) || null
    : null;
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

function assertTaskDoesNotContain(task, snippet) {
  const text = Array.isArray(task?.messages)
    ? task.messages.map((message) => String(message?.text || "")).join("\n")
    : "";
  if (text.includes(snippet)) {
    throw new Error(`Forked task unexpectedly contains later branch text: ${snippet}`);
  }
}

function assertOkResult(result, label) {
  if (result.status !== "ok") {
    throw new Error(`${label} smoke request failed: ${JSON.stringify(result)}`);
  }
}

function readCanvas() {
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(smokeDir, canvasFileName), "utf8"));
      return {
        nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
      };
    } catch (error) {
      lastError = error;
      sleep(100);
    }
  }

  throw lastError || new Error(`Unable to read ${canvasFileName}`);
}

function writeCanvas(canvas) {
  fs.writeFileSync(path.join(smokeDir, canvasFileName), `${JSON.stringify(canvas, null, 2)}\n`, "utf8");
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
