#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ensureCommunityPluginEnabled,
  ensureObsidianVaultRegistered,
  findOpenObsidianVaultPath,
  isCommunityPluginEnabled,
  normalizeDirectoryPath,
  readJson,
  writeJson,
} from "./obsidian-vault-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const CODEX_APP_PATH = "/Applications/Codex.app";
const OBSIDIAN_APP_PATH = "/Applications/Obsidian.app";
const OPENAGENT_HOME = path.join(os.homedir(), ".openagent");
const DAEMON_CONFIG_PATH = path.join(OPENAGENT_HOME, "daemon-config.json");
const DAEMON_LOG_PATH = path.join(OPENAGENT_HOME, "daemon.log");
const DEFAULT_DAEMON_HOST = "127.0.0.1";
const DEFAULT_DAEMON_PORT = 4317;
const PLUGIN_ID = "openagent";

async function main() {
  const args = process.argv.slice(2).filter((value, index) => !(value === "--" && index === 0));
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "setup") {
    const options = parseSetupOptions(args.slice(1));
    await runSetup(options);
    return;
  }

  if (command === "bootstrap-repo") {
    const options = parseBootstrapRepoOptions(args.slice(1));
    await runBootstrapRepo(options);
    return;
  }

  if (command !== "setup") {
    throw new Error(`Unknown command: ${command}`);
  }
}

function parseSetupOptions(args) {
  const options = {
    skipInstall: false,
    skipDaemonStart: false,
    vaultPath: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") {
      continue;
    }
    if (value === "--help" || value === "-h") {
      printUsage();
      process.exit(0);
    }
    if (value === "--skip-install") {
      options.skipInstall = true;
      continue;
    }
    if (value === "--skip-daemon-start") {
      options.skipDaemonStart = true;
      continue;
    }
    if (value === "--vault") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --vault");
      }
      options.vaultPath = normalizeDirectoryPath(nextValue);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${value}`);
  }

  return options;
}

function parseBootstrapRepoOptions(args) {
  const options = {
    openObsidian: true,
    repoPath: "",
    skipDaemonStart: false,
    skipInstall: false,
    vaultName: "",
    vaultPath: "",
    vaultRoot: "",
    workspaceName: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") {
      continue;
    }
    if (value === "--help" || value === "-h") {
      printUsage();
      process.exit(0);
    }
    if (value === "--skip-install") {
      options.skipInstall = true;
      continue;
    }
    if (value === "--skip-daemon-start") {
      options.skipDaemonStart = true;
      continue;
    }
    if (value === "--no-open-obsidian") {
      options.openObsidian = false;
      continue;
    }
    if (value === "--repo") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --repo");
      }
      options.repoPath = normalizeDirectoryPath(nextValue);
      index += 1;
      continue;
    }
    if (value === "--vault") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --vault");
      }
      options.vaultPath = path.resolve(nextValue);
      index += 1;
      continue;
    }
    if (value === "--vault-root") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --vault-root");
      }
      options.vaultRoot = path.resolve(nextValue);
      index += 1;
      continue;
    }
    if (value === "--vault-name") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --vault-name");
      }
      options.vaultName = String(nextValue || "").trim();
      index += 1;
      continue;
    }
    if (value === "--workspace-name") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --workspace-name");
      }
      options.workspaceName = String(nextValue || "").trim();
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${value}`);
  }

  return options;
}

async function runSetup(options) {
  console.log("OpenAgent setup");
  console.log("");

  ensureSupportedPlatform();
  ensureNodeVersion();
  ensureCommandAvailable("pnpm", ["--version"], "Install pnpm before running setup.");
  ensureCodexDesktopInstalled();
  reportObsidianDesktopStatus();

  const vaultPath = await resolveSetupVaultPath(options.vaultPath);
  console.log(`Using Obsidian vault: ${vaultPath}`);

  if (!options.skipInstall) {
    console.log("");
    console.log("Installing workspace dependencies with pnpm...");
    runCommand("pnpm", ["install"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }

  console.log("");
  console.log("Linking the OpenAgent plugin into your vault...");
  runCommand(process.execPath, [path.join(repoRoot, "scripts", "link-obsidian-plugin.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENAGENT_OBSIDIAN_VAULT: vaultPath,
    },
    stdio: "inherit",
  });

  const pluginDataPath = writePluginDefaults(vaultPath);
  console.log(`Updated plugin defaults at ${pluginDataPath}`);

  if (!options.skipDaemonStart) {
    console.log("");
    await ensureDaemonRunning();
  }

  const pluginEnabled = isCommunityPluginEnabled(vaultPath, PLUGIN_ID);
  printNextSteps({ vaultPath, pluginEnabled, daemonStarted: !options.skipDaemonStart });
}

async function runBootstrapRepo(options) {
  console.log("OpenAgent repo bootstrap");
  console.log("");

  ensureSupportedPlatform();
  ensureNodeVersion();
  ensureCommandAvailable("pnpm", ["--version"], "Install pnpm before running bootstrap.");
  ensureCodexDesktopInstalled();
  reportObsidianDesktopStatus();

  const targetRepoPath = options.repoPath || normalizeDirectoryPath(process.cwd());
  const vaultPath = await resolveBootstrapVaultPath(targetRepoPath, options);

  console.log(`Using repo: ${targetRepoPath}`);
  console.log(`Using vault: ${vaultPath}`);

  fs.mkdirSync(vaultPath, { recursive: true });
  fs.mkdirSync(path.join(vaultPath, ".obsidian"), { recursive: true });

  if (!options.skipInstall) {
    console.log("");
    console.log("Installing workspace dependencies with pnpm...");
    runCommand("pnpm", ["install"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }

  console.log("");
  console.log("Linking the OpenAgent plugin into your vault...");
  runCommand(process.execPath, [path.join(repoRoot, "scripts", "link-obsidian-plugin.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENAGENT_OBSIDIAN_VAULT: vaultPath,
    },
    stdio: "inherit",
  });

  const pluginListPath = ensureCommunityPluginEnabled(vaultPath, PLUGIN_ID);
  const pluginDataPath = writePluginDefaults(vaultPath);
  const workspace = ensureWorkspaceScaffold({
    repoPath: targetRepoPath,
    vaultPath,
    workspaceName: options.workspaceName,
  });
  const obsidianRegistration = ensureObsidianVaultRegistered(vaultPath);

  console.log(`Enabled plugin in ${pluginListPath}`);
  console.log(`Updated plugin defaults at ${pluginDataPath}`);
  console.log(`Prepared workspace canvas at ${path.join(vaultPath, workspace.canvasPath)}`);
  console.log(`Registered vault in ${obsidianRegistration.configPath}`);

  if (!options.skipDaemonStart) {
    console.log("");
    await ensureDaemonRunning();
  }

  if (options.openObsidian) {
    console.log("");
    console.log("Opening Obsidian...");
    await openObsidianWorkspace({
      canvasPath: workspace.canvasPath,
      vaultId: obsidianRegistration.vaultId,
      vaultPath,
    });
  }

  printBootstrapNextSteps({
    canvasPath: workspace.canvasPath,
    daemonStarted: !options.skipDaemonStart,
    vaultPath,
  });
}

function printUsage() {
  console.log(`Usage:
  openagent setup [--vault /path/to/vault] [--skip-install] [--skip-daemon-start]
  openagent bootstrap-repo --repo /path/to/repo [--vault /path/to/vault] [--vault-root /path/to/vaults] [--vault-name "Repo Canvas"] [--workspace-name "Repo"] [--skip-install] [--skip-daemon-start] [--no-open-obsidian]

Commands:
  setup    Install dependencies, link the Obsidian plugin, prefill daemon settings, and start the daemon.
  bootstrap-repo
           Reuse the current Obsidian vault by default, or create a dedicated vault when --vault-root/--vault-name is provided. Then enable OpenAgent, create a workspace + Main.canvas, and open Obsidian.
`);
}

function ensureSupportedPlatform() {
  if (process.platform !== "darwin") {
    throw new Error("OpenAgent currently supports macOS only.");
  }
}

function ensureNodeVersion() {
  const [majorVersion] = String(process.versions.node || "").split(".");
  if (Number(majorVersion) >= 20) {
    return;
  }
  throw new Error(`OpenAgent setup requires Node.js 20 or newer. Found ${process.version}.`);
}

function ensureCommandAvailable(command, args, failureMessage) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status === 0) {
    return;
  }
  throw new Error(failureMessage);
}

function ensureCodexDesktopInstalled() {
  if (fs.existsSync(CODEX_APP_PATH)) {
    return;
  }
  throw new Error("Install Codex.app in /Applications before using OpenAgent.");
}

function reportObsidianDesktopStatus() {
  if (fs.existsSync(OBSIDIAN_APP_PATH)) {
    return;
  }
  console.log("Warning: Obsidian.app was not found in /Applications.");
  console.log("Setup can continue, but you will need Obsidian Desktop to use the plugin.");
}

async function resolveSetupVaultPath(cliVaultPath) {
  if (cliVaultPath) {
    return cliVaultPath;
  }

  const envVaultPath = process.env.OPENAGENT_OBSIDIAN_VAULT || process.env.OBSIDIAN_VAULT_PATH;
  if (envVaultPath) {
    return normalizeDirectoryPath(envVaultPath);
  }

  const detectedVaultPath = findOpenObsidianVaultPath();
  if (detectedVaultPath) {
    return detectedVaultPath;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "No open Obsidian vault was detected. Re-run with --vault /path/to/vault or OPENAGENT_OBSIDIAN_VAULT=/path/to/vault.",
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question("Enter the absolute path to your Obsidian vault: ");
    return normalizeDirectoryPath(answer);
  } finally {
    rl.close();
  }
}

function writePluginDefaults(vaultPath) {
  const pluginDataPath = path.join(vaultPath, ".obsidian", "plugins", PLUGIN_ID, "data.json");
  const existingState = readJson(pluginDataPath, {}) || {};
  const nextState = {
    ...existingState,
    settings: {
      ...existingState.settings,
      daemonLaunchCommand: `cd ${shellEscape(repoRoot)} && exec pnpm dev:daemon`,
      daemonLaunchCwd: repoRoot,
      daemonSandboxMode: String(existingState.settings?.daemonSandboxMode || "workspace-write"),
      workspaceRoot: String(existingState.settings?.workspaceRoot || "Workspaces"),
    },
  };
  writeJson(pluginDataPath, nextState);
  return pluginDataPath;
}

async function ensureDaemonRunning() {
  if (await isDaemonHealthy()) {
    console.log("OpenAgent daemon is already running.");
    return;
  }

  console.log("Starting the OpenAgent daemon...");
  fs.mkdirSync(path.dirname(DAEMON_LOG_PATH), { recursive: true });

  const child = spawn("/bin/zsh", ["-lc", `cd ${shellEscape(repoRoot)} && exec pnpm dev:daemon >> ${shellEscape(DAEMON_LOG_PATH)} 2>&1`], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  await waitForDaemon();
  console.log("OpenAgent daemon is running.");
}

function readDaemonAddress() {
  const savedConfig = readJson(DAEMON_CONFIG_PATH, null);
  return {
    host: String(savedConfig?.host || DEFAULT_DAEMON_HOST),
    port: Number(savedConfig?.port || DEFAULT_DAEMON_PORT),
  };
}

function isDaemonHealthy() {
  const { host, port } = readDaemonAddress();
  return new Promise((resolve) => {
    const request = http.get(
      {
        host,
        port,
        path: "/health",
        timeout: 1000,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForDaemon() {
  let attemptsRemaining = 30;
  while (attemptsRemaining > 0) {
    if (await isDaemonHealthy()) {
      return;
    }
    attemptsRemaining -= 1;
    await sleep(500);
  }
  throw new Error(`OpenAgent daemon did not become ready. Check ${DAEMON_LOG_PATH} for details.`);
}

function printNextSteps({ vaultPath, pluginEnabled, daemonStarted }) {
  console.log("");
  console.log("Setup complete.");
  console.log("");
  console.log("Next:");
  if (!pluginEnabled) {
    console.log("1. Open Obsidian.");
    console.log("2. Go to Settings -> Community plugins and enable OpenAgent.");
    console.log(`3. Make sure you are in the vault at ${vaultPath}.`);
  } else {
    console.log("1. Open Obsidian.");
    console.log(`2. Make sure you are in the vault at ${vaultPath}.`);
    console.log("3. Open the OpenAgent panel or command palette.");
  }

  if (daemonStarted) {
    console.log("4. Run `OpenAgent: Choose workspace` and point it at the repo you want Codex to use.");
    console.log("5. Open a Canvas, select nodes, and run `OpenAgent: New thread from selection`.");
  } else {
    console.log("4. Start the daemon with `pnpm dev:daemon` when you are ready.");
    console.log("5. Run `OpenAgent: Choose workspace` and point it at the repo you want Codex to use.");
  }
}

function printBootstrapNextSteps({ canvasPath, daemonStarted, vaultPath }) {
  console.log("");
  console.log("Bootstrap complete.");
  console.log("");
  console.log("Next:");
  console.log(`1. Obsidian should open the vault at ${vaultPath}.`);
  console.log(`2. Open ${canvasPath} if it is not already focused.`);
  console.log("3. Select a node on the canvas and run `OpenAgent: New thread from selection`.");
  if (!daemonStarted) {
    console.log("4. Start the daemon with `pnpm dev:daemon` from your OpenAgent checkout before running a thread.");
  }
}

async function resolveBootstrapVaultPath(repoPath, options) {
  if (options.vaultPath) {
    return path.resolve(options.vaultPath);
  }

  if (options.vaultRoot || options.vaultName) {
    const defaultVaultRoot = options.vaultRoot
      ? path.resolve(options.vaultRoot)
      : path.join(os.homedir(), "Documents", "OpenAgent");
    const repoBaseName = path.basename(repoPath);
    const configuredVaultName = String(options.vaultName || "").trim() || `${repoBaseName} Canvas`;
    const safeVaultName = sanitizeVaultName(configuredVaultName);

    return path.join(defaultVaultRoot, safeVaultName);
  }

  const envVaultPath = process.env.OPENAGENT_OBSIDIAN_VAULT || process.env.OBSIDIAN_VAULT_PATH;
  if (envVaultPath) {
    return normalizeDirectoryPath(envVaultPath);
  }

  const openVaultPath = findOpenObsidianVaultPath();
  if (openVaultPath) {
    return openVaultPath;
  }

  return path.join(os.homedir(), "Documents", "OpenAgent", `${path.basename(repoPath)} Canvas`);
}

function sanitizeVaultName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "OpenAgent Vault";
  }

  return trimmed.replace(/[/:]/g, "-");
}

function ensureWorkspaceScaffold({ repoPath, vaultPath, workspaceName }) {
  const normalizedRepoPath = normalizeDirectoryPath(repoPath);
  const pluginStatePath = path.join(vaultPath, ".obsidian", "plugins", PLUGIN_ID, "data.json");
  const pluginState = readJson(pluginStatePath, {}) || {};
  const workspaceRoot = String(pluginState.settings?.workspaceRoot || "Workspaces").trim() || "Workspaces";
  const existingWorkspace = findWorkspaceForRepo(vaultPath, normalizedRepoPath, workspaceRoot);
  if (existingWorkspace) {
    return existingWorkspace;
  }

  const nextWorkspaceName = String(workspaceName || "").trim() || path.basename(normalizedRepoPath);
  const baseFolderName = slugifyWorkspaceName(nextWorkspaceName);
  let folderName = baseFolderName;
  let suffix = 2;
  while (fs.existsSync(path.join(vaultPath, workspaceRoot, folderName, "workspace.json"))) {
    folderName = `${baseFolderName}-${suffix}`;
    suffix += 1;
  }

  const workspaceFolderPath = path.join(vaultPath, workspaceRoot, folderName);
  fs.mkdirSync(workspaceFolderPath, { recursive: true });

  const workspace = {
    canvasPath: path.join(workspaceRoot, folderName, "Main.canvas"),
    configPath: path.join(workspaceRoot, folderName, "workspace.json"),
    folderPath: path.join(workspaceRoot, folderName),
    name: nextWorkspaceName,
    repoPath: normalizedRepoPath,
  };

  writeJson(path.join(vaultPath, workspace.configPath), {
    createdAt: new Date().toISOString(),
    defaultCanvas: "Main.canvas",
    name: workspace.name,
    repoPath: workspace.repoPath,
  });
  fs.writeFileSync(
    path.join(vaultPath, workspace.canvasPath),
    buildDefaultWorkspaceCanvas(workspace.name, workspace.repoPath),
    "utf8",
  );

  return workspace;
}

function findWorkspaceForRepo(vaultPath, repoPath, workspaceRoot = "Workspaces") {
  const workspaceRootPath = path.join(vaultPath, workspaceRoot);
  if (!fs.existsSync(workspaceRootPath)) {
    return null;
  }

  const configPaths = listWorkspaceConfigPaths(workspaceRootPath);
  for (const configPath of configPaths) {
    const parsed = readJson(configPath, null);
    const configRepoPath = String(parsed?.repoPath || "").trim();
    if (configRepoPath !== repoPath) {
      continue;
    }

    const workspaceFolderPath = path.dirname(configPath);
    return {
      canvasPath: path.relative(vaultPath, path.join(workspaceFolderPath, String(parsed?.defaultCanvas || "Main.canvas"))),
      configPath: path.relative(vaultPath, configPath),
      folderPath: path.relative(vaultPath, workspaceFolderPath),
      name: String(parsed?.name || path.basename(workspaceFolderPath) || "Workspace").trim(),
      repoPath,
    };
  }

  return null;
}

function listWorkspaceConfigPaths(rootPath) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listWorkspaceConfigPaths(absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name === "workspace.json") {
      results.push(absolutePath);
    }
  }

  return results;
}

function slugifyWorkspaceName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "workspace";
}

function buildDefaultWorkspaceCanvas(name, repoPath) {
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
          "- Optional context: markdown file nodes, or markdown files in the same group",
          "- Follow-up: connect a new text node to a previous result node, then run again",
          "- OpenAgent writes the answer back to the canvas",
        ].join("\n"),
      },
    ],
    edges: [],
  }, null, 2) + "\n";
}

async function openObsidianWorkspace({ vaultId, vaultPath, canvasPath }) {
  const absoluteCanvasPath = path.join(vaultPath, canvasPath);
  const vaultName = path.basename(vaultPath);

  try {
    runCommand("open", ["-a", "Obsidian", absoluteCanvasPath]);
  } catch {
    try {
      runCommand("open", ["-a", "Obsidian", vaultPath]);
    } catch {
      return;
    }
  }

  await sleep(1200);

  try {
    runCommand("open", [
      `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(canvasPath)}`,
    ]);
  } catch {
    try {
      runCommand("open", [
        `obsidian://open?vault=${encodeURIComponent(vaultId)}&file=${encodeURIComponent(canvasPath)}`,
      ]);
    } catch {
      // Opening the vault is enough; opening the canvas is a best-effort convenience.
    }
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: options.stdio || "pipe",
  });
  if (result.status === 0) {
    return result;
  }
  throw new Error(`Command failed: ${command} ${args.join(" ")}`);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  console.error("");
  console.error(`OpenAgent setup failed: ${String(error?.message || error)}`);
  process.exit(1);
});
