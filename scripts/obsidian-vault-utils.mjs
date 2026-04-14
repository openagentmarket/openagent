import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const OBSIDIAN_CONFIG_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "obsidian",
  "obsidian.json",
);

export function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function normalizeDirectoryPath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error("A directory path is required.");
  }

  const normalizedPath = path.resolve(trimmed);
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Directory does not exist: ${normalizedPath}`);
  }

  const stats = fs.statSync(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${normalizedPath}`);
  }

  return normalizedPath;
}

export function findOpenObsidianVaultPath() {
  const parsed = readJson(OBSIDIAN_CONFIG_PATH, null);
  const openVaultEntry = Object.values(parsed?.vaults || {})
    .filter((vault) => vault?.open && vault?.path)
    .sort((left, right) => Number(right?.ts || 0) - Number(left?.ts || 0))[0];
  return openVaultEntry?.path ? path.resolve(String(openVaultEntry.path)) : "";
}

export function resolveOpenVaultPath(options = {}) {
  const env = options.env || process.env;
  const explicitVaultPath = env.OPENAGENT_OBSIDIAN_VAULT || env.OBSIDIAN_VAULT_PATH;
  if (explicitVaultPath) {
    return normalizeDirectoryPath(explicitVaultPath);
  }

  const openVaultPath = findOpenObsidianVaultPath();
  if (openVaultPath) {
    return openVaultPath;
  }

  if (!fs.existsSync(OBSIDIAN_CONFIG_PATH)) {
    throw new Error(
      "No Obsidian vault path was provided. Set OPENAGENT_OBSIDIAN_VAULT=/path/to/vault or open a vault in Obsidian.",
    );
  }

  throw new Error(
    "No open Obsidian vault was found in obsidian.json. Set OPENAGENT_OBSIDIAN_VAULT=/path/to/vault to choose one explicitly.",
  );
}

export function isCommunityPluginEnabled(vaultPath, pluginId) {
  const pluginsPath = path.join(vaultPath, ".obsidian", "community-plugins.json");
  const enabledPlugins = readJson(pluginsPath, []);
  return Array.isArray(enabledPlugins) && enabledPlugins.includes(pluginId);
}

export function ensureCommunityPluginEnabled(vaultPath, pluginId) {
  const pluginsPath = path.join(vaultPath, ".obsidian", "community-plugins.json");
  const enabledPlugins = readJson(pluginsPath, []);
  const nextPlugins = Array.isArray(enabledPlugins) ? [...enabledPlugins] : [];

  if (!nextPlugins.includes(pluginId)) {
    nextPlugins.push(pluginId);
    writeJson(pluginsPath, nextPlugins);
  }

  return pluginsPath;
}

export function ensureObsidianVaultRegistered(vaultPath) {
  const normalizedVaultPath = path.resolve(String(vaultPath || ""));
  const currentState = readJson(OBSIDIAN_CONFIG_PATH, {}) || {};
  const nextVaults = {
    ...(currentState.vaults || {}),
  };
  let vaultId = "";
  const existingEntry = Object.entries(nextVaults).find(([, vault]) => {
    return path.resolve(String(vault?.path || "")) === normalizedVaultPath;
  });

  if (existingEntry) {
    const [existingVaultId, vaultState] = existingEntry;
    vaultId = existingVaultId;
    nextVaults[vaultId] = {
      ...vaultState,
      path: normalizedVaultPath,
      ts: Number(vaultState?.ts || Date.now()),
    };
  } else {
    vaultId = crypto.randomBytes(8).toString("hex");
    nextVaults[vaultId] = {
      path: normalizedVaultPath,
      ts: Date.now(),
    };
  }

  writeJson(OBSIDIAN_CONFIG_PATH, {
    ...currentState,
    vaults: nextVaults,
  });

  return {
    configPath: OBSIDIAN_CONFIG_PATH,
    vaultId,
  };
}
