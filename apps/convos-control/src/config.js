import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OPENAGENT_HOME = path.join(os.homedir(), ".openagent");
const PROJECT_CONFIG_FILENAME = "project-config.json";
const DEFAULT_CONTROL_ROOM_NAME = "OpenAgent Control";
const DEFAULT_STATUS_UPDATE_DELAY_MS = 15_000;
const DEFAULT_DASHBOARD_HOST = "127.0.0.1";
const DEFAULT_DASHBOARD_PORT = 4321;

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(
    String(env.DATA_DIR || "").trim() || path.join(process.cwd(), ".convos-openagent"),
  );
  const projectPath = normalizeOptionalDirectory(
    env.OPENAGENT_PROJECT_PATH || env.CODEX_PROJECT_PATH || loadStoredProjectPath(dataDir),
  );
  const daemonConfig = loadDaemonConfig(env);

  return {
    dataDir,
    xmtpEnv: normalizeXmtpEnv(env.XMTP_ENV),
    xmtpApiUrl: normalizeOptionalString(env.XMTP_API_URL),
    controlRoomName: normalizeOptionalString(env.CONTROL_ROOM_NAME) || DEFAULT_CONTROL_ROOM_NAME,
    controlRoomDescription:
      normalizeOptionalString(env.CONTROL_ROOM_DESCRIPTION)
      || `Control OpenAgent for ${path.basename(projectPath || process.cwd())} from Convos.`,
    projectPath,
    daemonBaseUrl: daemonConfig.baseUrl,
    daemonToken: daemonConfig.token,
    dashboardHost: normalizeOptionalString(env.OPENAGENT_CONVOS_WEB_HOST) || DEFAULT_DASHBOARD_HOST,
    dashboardPort: parsePositiveInteger(
      env.OPENAGENT_CONVOS_WEB_PORT,
      DEFAULT_DASHBOARD_PORT,
      "OPENAGENT_CONVOS_WEB_PORT",
    ),
    statusUpdateDelayMs: parsePositiveInteger(
      env.STATUS_UPDATE_DELAY_MS,
      DEFAULT_STATUS_UPDATE_DELAY_MS,
      "STATUS_UPDATE_DELAY_MS",
    ),
    runtimeConfig: {
      approvalPolicy: normalizeOptionalString(env.OPENAGENT_APPROVAL_POLICY) || "never",
      sandboxMode: normalizeOptionalString(env.OPENAGENT_SANDBOX_MODE) || "workspace-write",
    },
  };
}

export function saveSelectedProjectPath(dataDir, projectPath) {
  const resolved = resolveSelectedProjectPath(projectPath);
  if (!resolved) {
    throw new Error("Project path is required.");
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ projectPath: resolved }, null, 2),
    "utf8",
  );
  return resolved;
}

export function resolveSelectedProjectPath(projectPath) {
  return normalizeOptionalDirectory(projectPath);
}

function loadDaemonConfig(env) {
  const explicitBaseUrl = normalizeOptionalString(env.OPENAGENT_DAEMON_URL);
  const explicitToken = normalizeOptionalString(env.OPENAGENT_DAEMON_TOKEN);
  if (explicitBaseUrl && explicitToken) {
    return {
      baseUrl: explicitBaseUrl.replace(/\/+$/, ""),
      token: explicitToken,
    };
  }

  const daemonConfigPath = path.join(OPENAGENT_HOME, "daemon-config.json");
  if (!fs.existsSync(daemonConfigPath)) {
    throw new Error(
      "OpenAgent daemon config was not found. Start the daemon first or set OPENAGENT_DAEMON_URL and OPENAGENT_DAEMON_TOKEN.",
    );
  }

  const parsed = JSON.parse(fs.readFileSync(daemonConfigPath, "utf8"));
  const host = normalizeOptionalString(env.OPENAGENT_DAEMON_HOST) || normalizeOptionalString(parsed.host);
  const port = parsePositiveInteger(
    normalizeOptionalString(env.OPENAGENT_DAEMON_PORT) || String(parsed.port || ""),
    0,
    "OPENAGENT_DAEMON_PORT",
  );
  const token = explicitToken || normalizeOptionalString(parsed.token);
  if (!host || !port || !token) {
    throw new Error("OpenAgent daemon config is incomplete.");
  }

  return {
    baseUrl: explicitBaseUrl || `http://${host}:${port}`,
    token,
  };
}

function loadStoredProjectPath(dataDir) {
  const filePath = path.join(dataDir, PROJECT_CONFIG_FILENAME);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeOptionalDirectory(parsed?.projectPath);
  } catch {
    return undefined;
  }
}

function normalizeOptionalDirectory(value) {
  const resolved = normalizeOptionalPath(value);
  if (!resolved) {
    return undefined;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project path must point to an existing directory: ${resolved}`);
  }
  return resolved;
}

function normalizeOptionalPath(value) {
  const normalized = normalizeOptionalString(value);
  return normalized ? path.resolve(normalized) : undefined;
}

function normalizeOptionalString(value) {
  if (value == null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

function normalizeXmtpEnv(value) {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (normalized === "production" || normalized === "dev" || normalized === "local") {
    return normalized;
  }
  throw new Error("XMTP_ENV is required and must be one of: production, dev, local.");
}

function parsePositiveInteger(value, fallback, name) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return fallback;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
