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
const requestId = `image-thread-smoke-${Date.now()}`;
const fixtureBaseName = requestId;
const canvasFileName = `${fixtureBaseName}.canvas`;
const canvasPathRelative = `${smokeDirName}/${canvasFileName}`;
const imageFileName = `${fixtureBaseName}.png`;
const imagePathRelative = `${smokeDirName}/${imageFileName}`;
const imageAbsolutePath = path.join(smokeDir, imageFileName);
const textNodeId = "image-smoke-text";
const imageNodeId = "image-smoke-file";
const textNodePrompt = "Inspect the selected image and explain what kind of asset it is.";

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

  assertSmokePrompt(result);
  const task = await fetchTask(result.taskId);
  assertTask(task);

  console.log("Obsidian image new-thread smoke passed.");
  console.log(JSON.stringify({
    requestId,
    taskId: task.taskId,
    threadId: task.threadId || "",
    status: task.status,
    canvasPath: canvasPathRelative,
    imagePath: imagePathRelative,
    nodeIds: task.selectionContext?.nodeIds || [],
    selectionDebug: result.selectionDebug,
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
        id: textNodeId,
        type: "text",
        x: 0,
        y: 0,
        width: 420,
        height: 180,
        text: textNodePrompt,
      },
      {
        id: imageNodeId,
        type: "file",
        x: 480,
        y: 0,
        width: 420,
        height: 240,
        file: imagePathRelative,
      },
    ],
    edges: [
      {
        id: "image-smoke-edge",
        fromNode: textNodeId,
        toNode: imageNodeId,
      },
    ],
  };

  fs.writeFileSync(
    imageAbsolutePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1EAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  fs.writeFileSync(path.join(smokeDir, canvasFileName), `${JSON.stringify(canvas, null, 2)}\n`, "utf8");
  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }
}

function writeSmokeRequest() {
  const request = {
    id: requestId,
    canvasPath: canvasPathRelative,
    nodeIds: [textNodeId, imageNodeId],
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

function assertSmokePrompt(result) {
  const prompt = String(result?.rawPrompt || "");
  const selectionDebug = String(result?.selectionDebug || "");

  if (!selectionDebug.includes("text=1") || !selectionDebug.includes("images=1")) {
    throw new Error(`Unexpected selection debug payload: ${selectionDebug || "(empty)"}`);
  }

  if (!prompt.includes(textNodePrompt) || !prompt.includes("Selected image files are attached to this turn as image inputs.")) {
    throw new Error(`Unexpected smoke raw prompt: ${prompt || "(empty)"}`);
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

function assertTask(task) {
  if (!task) {
    throw new Error("Smoke task could not be fetched.");
  }

  const textBlocks = Array.isArray(task?.selectionContext?.textBlocks) ? task.selectionContext.textBlocks : [];
  const markdownFiles = Array.isArray(task?.selectionContext?.markdownFiles) ? task.selectionContext.markdownFiles : [];
  const imageFiles = Array.isArray(task?.selectionContext?.imageFiles) ? task.selectionContext.imageFiles : [];
  const nodeIds = Array.isArray(task?.selectionContext?.nodeIds) ? task.selectionContext.nodeIds : [];

  if (textBlocks.length !== 1) {
    throw new Error(`Expected 1 selected text block on the task, received ${textBlocks.length}.`);
  }

  if (markdownFiles.length !== 0) {
    throw new Error(`Expected 0 markdown files on the task, received ${markdownFiles.length}.`);
  }

  if (imageFiles.length !== 1) {
    throw new Error(`Expected 1 selected image file on the task, received ${imageFiles.length}.`);
  }

  if (nodeIds.length !== 2 || !nodeIds.includes(textNodeId) || !nodeIds.includes(imageNodeId)) {
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

  if (String(task?.title || "") !== textNodePrompt) {
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
